#import "VtRpc.h"
#import "VtHost.h"
#import "VtServer.h"
#import "VtGame.h"
#import "../LauncherSplitViewController.h"
#import "../utils.h"
#import <AVFoundation/AVFoundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <UserNotifications/UserNotifications.h>
#import <os/proc.h>
#include <sys/utsname.h>
#include <unistd.h>

#pragma mark - helpers

static NSString *vtHome(void) {
    const char *h = getenv("AME_HOME");
    return h ? @(h) : NSHomeDirectory();
}

static NSString *vtResolved(NSString *p) {
    return [[p stringByStandardizingPath] stringByResolvingSymlinksInPath];
}

/// sandbox: JS may only touch files under the app's own home (AME_HOME: game files, accounts, launcher state)
static NSString *vtSafe(id p) {
    if (![p isKindOfClass:NSString.class] || [(NSString *)p length] == 0) { return nil; }
    NSString *real = vtResolved(p);
    NSString *home = vtResolved(vtHome());
    if ([real isEqualToString:home] || [real hasPrefix:[home stringByAppendingString:@"/"]]) { return real; }
    return nil;
}

static NSString *vtHex(const uint8_t *d, int n) {
    NSMutableString *s = [NSMutableString stringWithCapacity:n * 2];
    for (int i = 0; i < n; i++) { [s appendFormat:@"%02x", d[i]]; }
    return s;
}

/// streaming digest of a file (sha1 / sha256 / sha512)
static NSString *vtDigest(NSString *path, NSString *alg) {
    NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:path];
    if (!fh) { return nil; }
    CC_SHA1_CTX c1; CC_SHA256_CTX c256; CC_SHA512_CTX c512;
    BOOL is1 = [alg isEqualToString:@"sha1"], is512 = [alg isEqualToString:@"sha512"];
    if (is1) { CC_SHA1_Init(&c1); } else if (is512) { CC_SHA512_Init(&c512); } else { CC_SHA256_Init(&c256); }
    while (YES) {
        @autoreleasepool {
            NSData *chunk = [fh readDataOfLength:1 << 20];
            if (chunk.length == 0) { break; }
            if (is1) { CC_SHA1_Update(&c1, chunk.bytes, (CC_LONG)chunk.length); }
            else if (is512) { CC_SHA512_Update(&c512, chunk.bytes, (CC_LONG)chunk.length); }
            else { CC_SHA256_Update(&c256, chunk.bytes, (CC_LONG)chunk.length); }
        }
    }
    [fh closeFile];
    if (is1) { uint8_t d[CC_SHA1_DIGEST_LENGTH]; CC_SHA1_Final(d, &c1); return vtHex(d, CC_SHA1_DIGEST_LENGTH); }
    if (is512) { uint8_t d[CC_SHA512_DIGEST_LENGTH]; CC_SHA512_Final(d, &c512); return vtHex(d, CC_SHA512_DIGEST_LENGTH); }
    uint8_t d[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(d, &c256); return vtHex(d, CC_SHA256_DIGEST_LENGTH);
}

static NSString *vtOfflineUUID(NSString *name) {
    // java.util.UUID.nameUUIDFromBytes("OfflinePlayer:<name>")
    NSData *in = [[@"OfflinePlayer:" stringByAppendingString:name] dataUsingEncoding:NSUTF8StringEncoding];
    uint8_t d[CC_MD5_DIGEST_LENGTH];
    CC_MD5(in.bytes, (CC_LONG)in.length, d);
    d[6] = (d[6] & 0x0F) | 0x30;
    d[8] = (d[8] & 0x3F) | 0x80;
    NSString *h = vtHex(d, 16);
    return [NSString stringWithFormat:@"%@-%@-%@-%@-%@", [h substringWithRange:NSMakeRange(0, 8)], [h substringWithRange:NSMakeRange(8, 4)],
            [h substringWithRange:NSMakeRange(12, 4)], [h substringWithRange:NSMakeRange(16, 4)], [h substringWithRange:NSMakeRange(20, 12)]];
}

static NSString *vtModel(void) {
    struct utsname u;
    uname(&u);
    return [NSString stringWithFormat:@"Apple %s", u.machine];
}

#pragma mark - downloader

@interface VtDownload : NSObject <NSURLSessionDownloadDelegate>
@property (nonatomic, copy) NSString *dest, *tag, *sha256, *sha1;
@property (nonatomic, copy) VtRpcDone done;
@property (nonatomic) NSURLSession *session;
@property (nonatomic) NSTimeInterval lastEmit;
@property (nonatomic) NSString *movedPath;
@property (nonatomic) NSString *failure;
@end

@implementation VtDownload
- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)task didWriteData:(int64_t)n totalBytesWritten:(int64_t)w totalBytesExpectedToWrite:(int64_t)total {
    if (self.tag.length == 0 || total <= 0) { return; }
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    if (now - self.lastEmit < 0.25) { return; }
    self.lastEmit = now;
    [VtHost.shared emit:@"dl:progress" args:@[@{ @"tag": self.tag, @"pct": @(w * 100.0 / total) }]];
}
- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)task didFinishDownloadingToURL:(NSURL *)location {
    NSInteger code = [task.response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)task.response).statusCode : 0;
    if (code < 200 || code >= 300) { self.failure = [NSString stringWithFormat:@"HTTP %ld", (long)code]; return; }
    // the temp file is deleted when this returns: move it now
    NSString *part = [self.dest stringByAppendingString:@".part"];
    [NSFileManager.defaultManager createDirectoryAtPath:self.dest.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    [NSFileManager.defaultManager removeItemAtPath:part error:nil];
    NSError *e = nil;
    if ([NSFileManager.defaultManager moveItemAtURL:location toURL:[NSURL fileURLWithPath:part] error:&e]) {
        self.movedPath = part;
    } else {
        self.failure = e.localizedDescription ?: @"dosya taşınamadı";
    }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    [session finishTasksAndInvalidate];
    if (error) { self.done(nil, error.localizedDescription); return; }
    if (self.failure || !self.movedPath) { self.done(nil, self.failure ?: @"indirilemedi"); return; }
    if (self.sha256.length && ![vtDigest(self.movedPath, @"sha256").lowercaseString isEqualToString:self.sha256.lowercaseString]) {
        [NSFileManager.defaultManager removeItemAtPath:self.movedPath error:nil];
        self.done(nil, @"sha256 uyuşmuyor");
        return;
    }
    if (self.sha1.length && ![vtDigest(self.movedPath, @"sha1").lowercaseString isEqualToString:self.sha1.lowercaseString]) {
        [NSFileManager.defaultManager removeItemAtPath:self.movedPath error:nil];
        self.done(nil, @"sha1 uyuşmuyor");
        return;
    }
    [NSFileManager.defaultManager removeItemAtPath:self.dest error:nil];
    NSError *e = nil;
    if (![NSFileManager.defaultManager moveItemAtPath:self.movedPath toPath:self.dest error:&e]) {
        self.done(nil, e.localizedDescription);
        return;
    }
    self.done(@YES, nil);
}
@end

#pragma mark - file picker

@interface VtPicker : NSObject <UIDocumentPickerDelegate>
@property (nonatomic, copy) void (^done)(NSArray *files);
@end
static VtPicker *gPicker;

@implementation VtPicker
- (void)documentPicker:(UIDocumentPickerViewController *)c didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    NSString *dir = [[VtRpc.root stringByAppendingPathComponent:@"picked"] stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSMutableArray *out = [NSMutableArray new];
    for (NSURL *u in urls) {
        NSString *dst = [dir stringByAppendingPathComponent:u.lastPathComponent];
        BOOL scoped = [u startAccessingSecurityScopedResource];
        NSError *e = nil;
        if ([NSFileManager.defaultManager copyItemAtURL:u toURL:[NSURL fileURLWithPath:dst] error:&e]) {
            [out addObject:@{ @"path": dst, @"name": u.lastPathComponent }];
        }
        if (scoped) { [u stopAccessingSecurityScopedResource]; }
    }
    void (^d)(NSArray *) = self.done;
    gPicker = nil;
    if (d) { d(out); }
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)c {
    void (^d)(NSArray *) = self.done;
    gPicker = nil;
    if (d) { d(@[]); }
}
@end

#pragma mark - RPC

@implementation VtRpc

+ (NSString *)root {
    NSString *r = [vtHome() stringByAppendingPathComponent:@"vt"];
    [NSFileManager.defaultManager createDirectoryAtPath:r withIntermediateDirectories:YES attributes:nil error:nil];
    return r;
}

+ (void)dispatch:(NSString *)name args:(NSDictionary *)a completion:(VtRpcDone)done {
    @try {
        [self handle:name args:a done:done];
    } @catch (NSException *e) {
        NSLog(@"[VT] call %@ failed: %@", name, e);
        done(nil, e.reason ?: e.name);
    }
}

+ (NSDictionary *)appInfo {
    UIScreen *sc = UIScreen.mainScreen;
    CGRect nb = sc.nativeBounds;
    double w = MAX(nb.size.width, nb.size.height), h = MIN(nb.size.width, nb.size.height); // always landscape
    NSOperatingSystemVersion v = NSProcessInfo.processInfo.operatingSystemVersion;
    return @{
        @"version": NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"] ?: @"1.0.0",
        @"versionCode": @1,
        @"platform": @"ios",
        @"sdk": @(v.majorVersion),
        @"abi": @"arm64",
        @"model": vtModel(),
        @"cpus": @(NSProcessInfo.processInfo.activeProcessorCount),
        @"totalMemMb": @(NSProcessInfo.processInfo.physicalMemory / 1048576),
        @"freeMemMb": @(os_proc_available_memory() / 1048576),
        @"widthPx": @(w), @"heightPx": @(h),
        @"dpi": @(160.0 * sc.scale), @"density": @(sc.scale),
        @"refreshHz": @(sc.maximumFramesPerSecond),
        @"root": self.root,
        @"gameHome": VtGame.gameHome,
        @"gpu": @"Apple GPU (Metal)",
        @"vulkan": @YES
    };
}

+ (void)handle:(NSString *)name args:(NSDictionary *)a done:(VtRpcDone)done {
    NSFileManager *fm = NSFileManager.defaultManager;
    if ([name isEqualToString:@"log"]) { NSLog(@"[VT JS] %@", a[@"text"]); done(@YES, nil); return; }

    // ---- fs ----
    if ([name hasPrefix:@"fs."]) {
        NSString *p = vtSafe(a[@"path"] ?: a[@"from"]);
        if (!p) { done(nil, [NSString stringWithFormat:@"path outside sandbox: %@", a[@"path"] ?: a[@"from"]]); return; }
        BOOL isDir = NO;
        BOOL exists = [fm fileExistsAtPath:p isDirectory:&isDir];
        if ([name isEqualToString:@"fs.read"]) {
            NSString *t = (exists && !isDir) ? [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:nil] : nil;
            done(t ?: NSNull.null, nil);
        } else if ([name isEqualToString:@"fs.write"]) {
            [fm createDirectoryAtPath:p.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
            NSError *e = nil;
            BOOL ok = [(NSString *)(a[@"text"] ?: @"") writeToFile:p atomically:YES encoding:NSUTF8StringEncoding error:&e];
            done(ok ? @YES : nil, ok ? nil : e.localizedDescription);
        } else if ([name isEqualToString:@"fs.writeB64"]) {
            NSData *d = [[NSData alloc] initWithBase64EncodedString:a[@"b64"] ?: @"" options:NSDataBase64DecodingIgnoreUnknownCharacters];
            [fm createDirectoryAtPath:p.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
            BOOL ok = d && [d writeToFile:p atomically:YES];
            done(ok ? @YES : nil, ok ? nil : @"yazılamadı");
        } else if ([name isEqualToString:@"fs.readB64"]) {
            NSData *d = (exists && !isDir) ? [NSData dataWithContentsOfFile:p] : nil;
            done(d ? [d base64EncodedStringWithOptions:0] : NSNull.null, nil);
        } else if ([name isEqualToString:@"fs.exists"]) {
            done(@(exists), nil);
        } else if ([name isEqualToString:@"fs.mkdir"]) {
            done(@((exists && isDir) || [fm createDirectoryAtPath:p withIntermediateDirectories:YES attributes:nil error:nil]), nil);
        } else if ([name isEqualToString:@"fs.rm"]) {
            done(@(!exists || [fm removeItemAtPath:p error:nil]), nil);
        } else if ([name isEqualToString:@"fs.rename"]) {
            NSString *t = vtSafe(a[@"to"]);
            if (!t) { done(nil, @"path outside sandbox"); return; }
            [fm createDirectoryAtPath:t.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
            if ([fm fileExistsAtPath:t]) { [fm removeItemAtPath:t error:nil]; }
            done(@([fm moveItemAtPath:p toPath:t error:nil]), nil);
        } else if ([name isEqualToString:@"fs.copy"]) {
            NSString *t = vtSafe(a[@"to"]);
            if (!t) { done(nil, @"path outside sandbox"); return; }
            if (!exists) { done(@NO, nil); return; }
            [fm createDirectoryAtPath:t.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
            if ([fm fileExistsAtPath:t]) { [fm removeItemAtPath:t error:nil]; }
            done(@([fm copyItemAtPath:p toPath:t error:nil]), nil);
        } else if ([name isEqualToString:@"fs.stat"]) {
            if (!exists) { done(NSNull.null, nil); return; }
            NSDictionary *at = [fm attributesOfItemAtPath:p error:nil];
            done(@{ @"size": at[NSFileSize] ?: @0, @"mtime": @([at.fileModificationDate timeIntervalSince1970] * 1000), @"isDir": @(isDir) }, nil);
        } else if ([name isEqualToString:@"fs.list"]) {
            NSMutableArray *out = [NSMutableArray new];
            for (NSString *e in [fm contentsOfDirectoryAtPath:p error:nil]) {
                NSString *full = [p stringByAppendingPathComponent:e];
                BOOL d2 = NO;
                [fm fileExistsAtPath:full isDirectory:&d2];
                NSDictionary *at = [fm attributesOfItemAtPath:full error:nil];
                [out addObject:@{ @"name": e, @"isDir": @(d2), @"size": d2 ? @0 : (at[NSFileSize] ?: @0), @"mtime": @([at.fileModificationDate timeIntervalSince1970] * 1000) }];
            }
            done(out, nil);
        } else if ([name isEqualToString:@"fs.sha"]) {
            NSString *alg = a[@"alg"] ?: @"sha256";
            NSString *h = (exists && !isDir) ? vtDigest(p, alg) : nil;
            done(h, h ? nil : @"dosya okunamadı");
        } else {
            done(nil, [@"unknown native call: " stringByAppendingString:name]);
        }
        return;
    }

    // ---- kv ----
    if ([name isEqualToString:@"kv.get"]) { done([NSUserDefaults.standardUserDefaults stringForKey:[@"vt.kv." stringByAppendingString:a[@"key"]]] ?: NSNull.null, nil); return; }
    if ([name isEqualToString:@"kv.set"]) { [NSUserDefaults.standardUserDefaults setObject:a[@"value"] forKey:[@"vt.kv." stringByAppendingString:a[@"key"]]]; done(@YES, nil); return; }
    if ([name isEqualToString:@"kv.del"]) { [NSUserDefaults.standardUserDefaults removeObjectForKey:[@"vt.kv." stringByAppendingString:a[@"key"]]]; done(@YES, nil); return; }

    // ---- network ----
    if ([name isEqualToString:@"http"]) { [self http:a done:done]; return; }
    if ([name isEqualToString:@"download"]) {
        NSString *dest = vtSafe(a[@"dest"]);
        NSURL *url = [NSURL URLWithString:a[@"url"] ?: @""];
        if (!dest || !url) { done(nil, @"geçersiz indirme"); return; }
        VtDownload *d = [VtDownload new];
        d.dest = dest;
        d.tag = a[@"tag"] ?: @"";
        d.sha256 = a[@"sha256"] ?: @"";
        d.sha1 = a[@"sha1"] ?: @"";
        d.done = done;
        NSURLSessionConfiguration *cfg = NSURLSessionConfiguration.defaultSessionConfiguration;
        cfg.timeoutIntervalForRequest = MAX(30, [a[@"timeoutMs"] doubleValue] / 1000.0);
        d.session = [NSURLSession sessionWithConfiguration:cfg delegate:d delegateQueue:nil];
        NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
        [req setValue:@"VanillaTurkeyMobile/1" forHTTPHeaderField:@"User-Agent"];
        [[d.session downloadTaskWithRequest:req] resume];
        return;
    }

    // ---- device / app ----
    if ([name isEqualToString:@"app.info"]) { done([self appInfo], nil); return; }
    if ([name isEqualToString:@"uuid.offline"]) { done(@{ @"uuid": vtOfflineUUID(a[@"name"] ?: @"") }, nil); return; }
    if ([name isEqualToString:@"ui.ready"]) { VtHost.shared.pageReady = YES; done(@YES, nil); return; }
    if ([name isEqualToString:@"ui.moveToBack"] || [name isEqualToString:@"ui.moveToFront"]) { done(@YES, nil); return; }
    if ([name isEqualToString:@"ui.openUrl"]) {
        NSURL *u = [NSURL URLWithString:a[@"url"] ?: @""];
        if ([u.scheme isEqualToString:@"https"]) {
            dispatch_async(dispatch_get_main_queue(), ^{ [UIApplication.sharedApplication openURL:u options:@{} completionHandler:nil]; });
        }
        done(@YES, nil);
        return;
    }
    if ([name isEqualToString:@"app.openSource"]) { [self openSource:a[@"url"] fallback:a[@"fallback"]]; done(@YES, nil); return; }
    if ([name isEqualToString:@"ui.pickFiles"]) { [self pickFiles:a done:done]; return; }
    if ([name isEqualToString:@"ui.openNative"]) { [self openNative:a[@"screen"]]; done(@YES, nil); return; }
    if ([name isEqualToString:@"app.installApk"]) { done(@YES, nil); return; }

    // ---- permissions / audio / notifications ----
    if ([name isEqualToString:@"perm.mic"]) {
        [AVAudioSession.sharedInstance requestRecordPermission:^(BOOL granted) { done(@(granted), nil); }];
        return;
    }
    if ([name isEqualToString:@"perm.state"]) {
        done(@{ @"mic": @(AVAudioSession.sharedInstance.recordPermission == AVAudioSessionRecordPermissionGranted), @"overlay": @YES }, nil);
        return;
    }
    if ([name isEqualToString:@"perm.overlay"]) { done(@YES, nil); return; }
    if ([name isEqualToString:@"voice.service"]) {
        BOOL on = [a[@"on"] boolValue];
        if (on) {
            // voice room: play + record, mixed with the game's own OpenAL output, speaker by default
            AVAudioSession *s = AVAudioSession.sharedInstance;
            [s setCategory:AVAudioSessionCategoryPlayAndRecord
               withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionMixWithOthers | AVAudioSessionCategoryOptionAllowBluetooth
                     error:nil];
            [s setActive:YES error:nil];
        }
        done(@YES, nil);
        return;
    }
    if ([name isEqualToString:@"notif.show"]) { [self notify:a]; done(@YES, nil); return; }
    if ([name isEqualToString:@"notif.badge"]) { done(@YES, nil); return; }

    // ---- bridge ----
    if ([name isEqualToString:@"bridge.info"]) { done(@{ @"port": @(VtServer.shared.port), @"token": VtServer.shared.token }, nil); return; }
    if ([name isEqualToString:@"bridge.send"]) {
        id idv = a[@"id"];
        NSDictionary *m = [a[@"msg"] isKindOfClass:NSDictionary.class] ? a[@"msg"] : nil;
        if (m) { [VtServer.shared sendMessage:m toClient:[idv isKindOfClass:NSNumber.class] ? idv : nil]; }
        done(@YES, nil);
        return;
    }
    if ([name isEqualToString:@"bridge.ready"]) { VtServer.shared.rendererReady = [a[@"ready"] boolValue]; done(@YES, nil); return; }
    if ([name isEqualToString:@"bridge.count"]) { done(@([VtServer.shared clientCount]), nil); return; }

    // ---- game ----
    if ([name isEqualToString:@"game.dir"]) { done(@{ @"dir": [VtGame profileDirForName:a[@"name"] ?: @"default"] }, nil); return; }
    if ([name isEqualToString:@"game.ensure"]) {
        [VtGame ensureName:a[@"name"] mc:a[@"mc"]
                  progress:^(double pct, NSString *text) { [VtHost.shared emit:@"ensure:progress" args:@[@{ @"pct": @(MAX(0, MIN(100, (pct - 2) / 70.0 * 100))), @"text": text ?: @"" }]]; }
                completion:^(NSString *error) { done(error ? nil : @YES, error); }];
        return;
    }
    if ([name isEqualToString:@"game.launch"]) {
        [VtGame launch:a completion:^(NSDictionary *r) { done(r, nil); }];
        return;
    }
    if ([name isEqualToString:@"game.stop"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ exit(0); });
        done(@YES, nil);
        return;
    }
    if ([name isEqualToString:@"game.renderers"]) { done(VtGame.renderers, nil); return; }
    if ([name isEqualToString:@"auth.microsoft"]) {
        done(@{ @"ok": @NO, @"error": @"Microsoft girişi için: Ayarlar > Gelişmiş ayarlar > Hesaplar." }, nil);
        return;
    }
    done(nil, [@"unknown native call: " stringByAppendingString:name]);
}

#pragma mark - http

+ (void)http:(NSDictionary *)a done:(VtRpcDone)done {
    NSURL *url = [NSURL URLWithString:a[@"url"] ?: @""];
    if (!url) { done(@{ @"status": @0, @"headers": @{}, @"text": @"", @"error": @"bad url" }, nil); return; }
    NSString *method = [(a[@"method"] ?: @"GET") uppercaseString];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:MAX(5, [a[@"timeoutMs"] doubleValue] / 1000.0 ?: 30)];
    req.HTTPMethod = method;
    NSDictionary *hs = [a[@"headers"] isKindOfClass:NSDictionary.class] ? a[@"headers"] : @{};
    for (NSString *k in hs) { [req setValue:[NSString stringWithFormat:@"%@", hs[k]] forHTTPHeaderField:k]; }
    if ([a[@"bodyB64"] isKindOfClass:NSString.class]) {
        req.HTTPBody = [[NSData alloc] initWithBase64EncodedString:a[@"bodyB64"] options:NSDataBase64DecodingIgnoreUnknownCharacters];
    } else if ([a[@"body"] isKindOfClass:NSString.class]) {
        req.HTTPBody = [a[@"body"] dataUsingEncoding:NSUTF8StringEncoding];
        if (![req valueForHTTPHeaderField:@"Content-Type"]) { [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"]; }
    }
    if (![method isEqualToString:@"GET"] && ![method isEqualToString:@"HEAD"] && !req.HTTPBody && ![method isEqualToString:@"DELETE"]) {
        req.HTTPBody = [NSData data];
    }
    BOOL binary = [a[@"binary"] boolValue];
    NSURLSessionConfiguration *cfg = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    cfg.timeoutIntervalForResource = MAX(10, [a[@"timeoutMs"] doubleValue] / 1000.0 ?: 30);
    NSURLSession *s = [NSURLSession sessionWithConfiguration:cfg];
    [[s dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        if (err || ![resp isKindOfClass:NSHTTPURLResponse.class]) {
            done(@{ @"status": @0, @"headers": @{}, @"text": @"", @"error": err.localizedDescription ?: @"net" }, nil);
        } else {
            NSHTTPURLResponse *h = (NSHTTPURLResponse *)resp;
            NSMutableDictionary *headers = [NSMutableDictionary new];
            for (id k in h.allHeaderFields) { headers[[[NSString stringWithFormat:@"%@", k] lowercaseString]] = [NSString stringWithFormat:@"%@", h.allHeaderFields[k]]; }
            NSMutableDictionary *out = [@{ @"status": @(h.statusCode), @"headers": headers } mutableCopy];
            if (binary) {
                out[@"b64"] = [(data ?: [NSData data]) base64EncodedStringWithOptions:0];
            } else {
                out[@"text"] = [[NSString alloc] initWithData:data ?: [NSData data] encoding:NSUTF8StringEncoding] ?: @"";
            }
            done(out, nil);
        }
        [s finishTasksAndInvalidate];
    }] resume];
}

#pragma mark - UI helpers

+ (void)openSource:(NSString *)sourceUrl fallback:(NSString *)fallback {
    NSString *enc = [(sourceUrl ?: @"") stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLQueryAllowedCharacterSet];
    NSURL *sidestore = [NSURL URLWithString:[@"sidestore://source?url=" stringByAppendingString:enc]];
    NSURL *altstore = [NSURL URLWithString:[@"altstore://source?url=" stringByAppendingString:enc]];
    NSURL *web = [NSURL URLWithString:fallback ?: @""];
    dispatch_async(dispatch_get_main_queue(), ^{
        UIApplication *app = UIApplication.sharedApplication;
        [app openURL:sidestore options:@{} completionHandler:^(BOOL ok) {
            if (ok) { return; }
            [app openURL:altstore options:@{} completionHandler:^(BOOL ok2) {
                if (!ok2 && [web.scheme isEqualToString:@"https"]) { [app openURL:web options:@{} completionHandler:nil]; }
            }];
        }];
    });
}

+ (void)pickFiles:(NSDictionary *)a done:(VtRpcDone)done {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *mime = a[@"mime"] ?: @"*/*";
        UTType *t = UTTypeItem;
        if ([mime isEqualToString:@"image/png"]) { t = UTTypePNG; }
        else if ([mime hasPrefix:@"image/"]) { t = UTTypeImage; }
        else if ([mime isEqualToString:@"application/zip"]) { t = UTTypeZIP; }
        UIDocumentPickerViewController *pc = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[t] asCopy:NO];
        pc.allowsMultipleSelection = [a[@"multiple"] boolValue];
        VtPicker *pk = [VtPicker new];
        pk.done = ^(NSArray *files) { done(files, nil); };
        gPicker = pk;
        pc.delegate = pk;
        pc.modalPresentationStyle = UIModalPresentationFormSheet;
        [currentVC() presentViewController:pc animated:YES completion:nil];
    });
}

/// Amethyst's own screens (accounts, Java runtimes, controls editor, renderer / JIT debug options) in a modal with a close button
+ (void)openNative:(NSString *)screen {
    dispatch_async(dispatch_get_main_queue(), ^{
        LauncherSplitViewController *vc = [[LauncherSplitViewController alloc] initWithStyle:UISplitViewControllerStyleDoubleColumn];
        vc.modalPresentationStyle = UIModalPresentationFullScreen;
        [vc loadViewIfNeeded];
        UIButton *close = [UIButton buttonWithType:UIButtonTypeSystem];
        [close setTitle:@"  Kapat  " forState:UIControlStateNormal];
        close.backgroundColor = [UIColor colorWithRed:0.1 green:0.2 blue:0.4 alpha:0.85];
        close.tintColor = UIColor.whiteColor;
        close.layer.cornerRadius = 14;
        close.frame = CGRectMake(0, 0, 84, 30);
        close.autoresizingMask = UIViewAutoresizingFlexibleLeftMargin | UIViewAutoresizingFlexibleBottomMargin;
        close.center = CGPointMake(vc.view.bounds.size.width - 60, vc.view.safeAreaInsets.top + 24);
        __weak UIViewController *weakVc = vc;
        [close addAction:[UIAction actionWithHandler:^(UIAction *act) { [weakVc dismissViewControllerAnimated:YES completion:nil]; }]
            forControlEvents:UIControlEventTouchUpInside];
        [vc.view addSubview:close];
        [currentVC() presentViewController:vc animated:YES completion:nil];
    });
}

+ (void)notify:(NSDictionary *)a {
    UNUserNotificationCenter *c = UNUserNotificationCenter.currentNotificationCenter;
    [c requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound) completionHandler:^(BOOL granted, NSError *e) {
        if (!granted) { return; }
        UNMutableNotificationContent *n = [UNMutableNotificationContent new];
        n.title = a[@"title"] ?: @"VanillaTurkey";
        n.body = a[@"body"] ?: @"";
        n.sound = UNNotificationSound.defaultSound;
        NSString *ident = [NSString stringWithFormat:@"vt.%@", a[@"channel"] ?: NSUUID.UUID.UUIDString];
        [c addNotificationRequest:[UNNotificationRequest requestWithIdentifier:ident content:n trigger:nil] withCompletionHandler:nil];
    }];
}

@end
