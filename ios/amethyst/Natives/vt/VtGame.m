#import "VtGame.h"
#import "VtHost.h"
#import "../authenticator/BaseAuthenticator.h"
#import "../customcontrols/CustomControlsUtils.h"
#import "../MinecraftResourceDownloadTask.h"
#import "../LauncherPreferences.h"
#import "../PLProfiles.h"
#import "../UIKit+hook.h"
#import "../ios_uikit_bridge.h"
#import "../utils.h"
#import "ALTServerConnection.h"
#include "../glfw_keycodes.h"
#include <unistd.h>

// Amethyst keeps the Mojang version list in this global (LauncherNavigationController.h); the downloader reads it
extern NSMutableArray<NSDictionary *> *remoteVersionList;

static NSDictionary *gMetadata;      // processed version json of the last successful ensure (what launchJVM wants)
static NSString *gMetadataName;      // profile name it belongs to

#define VT_MANIFEST_URL @"https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

#pragma mark - small helpers

static id vtGetJSON(NSString *url, NSTimeInterval timeout) {
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url] cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:timeout];
    [req setValue:@"VanillaTurkeyMobile/1" forHTTPHeaderField:@"User-Agent"];
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block id out = nil;
    NSURLSessionDataTask *t = [NSURLSession.sharedSession dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        NSInteger code = [resp isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)resp).statusCode : 0;
        if (data && !err && code >= 200 && code < 300) {
            out = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil];
        }
        dispatch_semaphore_signal(sem);
    }];
    [t resume];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    return out;
}

static NSString *vtAmeHome(void) {
    const char *h = getenv("AME_HOME");
    return h ? @(h) : NSHomeDirectory();
}

static NSString *vtGameDir(void) {
    const char *g = getenv("GAME_DIR");
    return g ? @(g) : [vtAmeHome() stringByAppendingPathComponent:@"Library/Application Support/minecraft"];
}

static NSString *vtSafeName(NSString *s) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"] invertedSet];
    return [[s componentsSeparatedByCharactersInSet:bad] componentsJoinedByString:@"_"];
}

@implementation VtGame

#pragma mark - paths

+ (NSString *)gameHome {
    NSString *dir = getPrefObject(@"general.game_directory");
    if (![dir isKindOfClass:NSString.class] || dir.length == 0) { dir = @"default"; }
    return [[vtAmeHome() stringByAppendingPathComponent:@"instances"] stringByAppendingPathComponent:dir];
}

+ (NSString *)profileDirForName:(NSString *)name {
    NSString *d = [[self.gameHome stringByAppendingPathComponent:@"vt"] stringByAppendingPathComponent:vtSafeName(name)];
    [NSFileManager.defaultManager createDirectoryAtPath:d withIntermediateDirectories:YES attributes:nil error:nil];
    return d;
}

#pragma mark - install

/// Mojang's version manifest; cached on disk so a later offline start can still reuse already downloaded versions
+ (NSArray<NSDictionary *> *)mojangVersions:(NSString **)error {
    NSString *cache = [[vtAmeHome() stringByAppendingPathComponent:@"vt"] stringByAppendingPathComponent:@"mojang_manifest.json"];
    NSDictionary *m = vtGetJSON(VT_MANIFEST_URL, 20);
    if ([m isKindOfClass:NSDictionary.class] && [m[@"versions"] isKindOfClass:NSArray.class]) {
        [NSFileManager.defaultManager createDirectoryAtPath:cache.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
        [[NSJSONSerialization dataWithJSONObject:m options:0 error:nil] writeToFile:cache atomically:YES];
        return m[@"versions"];
    }
    NSData *d = [NSData dataWithContentsOfFile:cache];
    id c = d ? [NSJSONSerialization JSONObjectWithData:d options:NSJSONReadingMutableContainers error:nil] : nil;
    if ([c isKindOfClass:NSDictionary.class] && [c[@"versions"] isKindOfClass:NSArray.class]) { return c[@"versions"]; }
    if (error) { *error = @"Mojang sürüm listesi alınamadı. İnternet bağlantını kontrol et."; }
    return nil;
}

/// id of the installed Fabric profile for this Minecraft version ("fabric-loader-<loader>-<mc>"); installs the newest stable loader when none exists
+ (NSString *)fabricIdForMC:(NSString *)mc error:(NSString **)error {
    NSString *versionsDir = [vtGameDir() stringByAppendingPathComponent:@"versions"];
    NSString *suffix = [@"-" stringByAppendingString:mc];
    NSMutableArray<NSString *> *local = [NSMutableArray new];
    for (NSString *e in [NSFileManager.defaultManager contentsOfDirectoryAtPath:versionsDir error:nil]) {
        if ([e hasPrefix:@"fabric-loader-"] && [e hasSuffix:suffix] &&
            [NSFileManager.defaultManager fileExistsAtPath:[NSString stringWithFormat:@"%@/%@/%@.json", versionsDir, e, e]]) {
            [local addObject:e];
        }
    }
    [local sortUsingComparator:^NSComparisonResult(NSString *a, NSString *b) { return [a compare:b options:NSNumericSearch]; }];
    if (local.count) { return local.lastObject; }

    id loaders = vtGetJSON([NSString stringWithFormat:@"https://meta.fabricmc.net/v2/versions/loader/%@", mc], 20);
    if (![loaders isKindOfClass:NSArray.class] || ![loaders count]) {
        if (error) { *error = [NSString stringWithFormat:@"Fabric %@ için bulunamadı veya erişilemiyor.", mc]; }
        return nil;
    }
    NSString *lv = nil;
    for (NSDictionary *l in loaders) {
        if ([l[@"loader"][@"stable"] boolValue]) { lv = l[@"loader"][@"version"]; break; }
    }
    if (!lv) { lv = [loaders firstObject][@"loader"][@"version"]; }
    NSDictionary *prof = vtGetJSON([NSString stringWithFormat:@"https://meta.fabricmc.net/v2/versions/loader/%@/%@/profile/json", mc, lv], 20);
    NSString *fid = [prof isKindOfClass:NSDictionary.class] ? prof[@"id"] : nil;
    if (fid.length == 0) {
        if (error) { *error = @"Fabric profili alınamadı."; }
        return nil;
    }
    NSString *path = [NSString stringWithFormat:@"%@/%@/%@.json", versionsDir, fid, fid];
    [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    NSError *we = saveJSONToFile(prof, path);
    if (we) {
        if (error) { *error = we.localizedDescription; }
        return nil;
    }
    return fid;
}

+ (void)upsertProfile:(NSString *)name fabricId:(NSString *)fid {
    PLProfiles *p = PLProfiles.current;
    NSMutableDictionary *prof = [(NSDictionary *)p.profiles[name] mutableCopy] ?: [NSMutableDictionary new];
    prof[@"name"] = name;
    prof[@"lastVersionId"] = fid;
    prof[@"gameDir"] = [@"vt/" stringByAppendingString:vtSafeName(name)];
    prof[@"icon"] = @"https://avatars.githubusercontent.com/u/21025855?s=64";
    ((NSMutableDictionary *)p.profiles)[name] = prof;
    [p setSelectedProfileName:name]; // also saves launcher_profiles.json
}

+ (void)ensureName:(NSString *)name mc:(NSString *)mc
          progress:(void (^)(double pct, NSString *text))progress
        completion:(void (^)(NSString *error))completion {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSString *err = nil;
        progress(2, @"Sürüm listesi alınıyor…");
        NSArray<NSDictionary *> *versions = [self mojangVersions:&err];
        if (!versions) { completion(err); return; }
        remoteVersionList = [NSMutableArray arrayWithArray:versions];

        progress(6, @"Fabric hazırlanıyor…");
        NSString *fid = [self fabricIdForMC:mc error:&err];
        if (!fid) { completion(err); return; }
        [self profileDirForName:name];
        dispatch_sync(dispatch_get_main_queue(), ^{ [self upsertProfile:name fabricId:fid]; });

        progress(8, @"Minecraft dosyaları kontrol ediliyor…");
        __block MinecraftResourceDownloadTask *task = [MinecraftResourceDownloadTask new];
        __block BOOL finished = NO;
        NSObject *lock = [NSObject new];
        void (^finish)(NSString *) = ^(NSString *e) {
            @synchronized (lock) {
                if (finished) { return; }
                finished = YES;
            }
            if (!e && task.metadata) {
                gMetadata = [task.metadata copy];
                gMetadataName = name;
            }
            completion(e);
        };
        task.handleError = ^{ finish(@"Minecraft dosyaları indirilemedi. Ayrıntı için uyarıya bak."); };
        [task downloadVersion:@{ @"id": fid, @"type": @"custom" }];

        dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
        dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), 300 * NSEC_PER_MSEC, 50 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(timer, ^{
            @synchronized (lock) {
                if (finished) { dispatch_source_cancel(timer); return; }
            }
            NSProgress *pr = task.progress;
            double f = pr ? pr.fractionCompleted : 0;
            progress(8 + f * 64, [NSString stringWithFormat:@"Oyun dosyaları indiriliyor %d%%", (int)(f * 100)]);
            if (pr && f >= 1.0 && task.metadata) {
                dispatch_source_cancel(timer);
                finish(nil);
            }
        });
        dispatch_resume(timer);
    });
}

#pragma mark - touch layout

/// Amethyst's default layout + three VanillaTurkey buttons (VT menu = Right Shift, mic push-to-talk = V, chat = N)
+ (void)ensureControlLayout {
    NSString *dir = [vtAmeHome() stringByAppendingPathComponent:@"controlmap"];
    NSString *out = [dir stringByAppendingPathComponent:@"vanillaturkey.json"];
    if ([NSFileManager.defaultManager fileExistsAtPath:out]) { return; }
    NSMutableDictionary *d = parseJSONFromFile([dir stringByAppendingPathComponent:@"default.json"]);
    if (!d || d[@"NSErrorObject"] || ![d[@"mControlDataList"] isKindOfClass:NSMutableArray.class]) { return; }
    NSMutableArray *list = d[@"mControlDataList"];
    struct { const char *name; int key; int slot; } extra[3] = {
        { "VT", GLFW_KEY_RIGHT_SHIFT, 0 }, { "MİK", GLFW_KEY_V, 1 }, { "SOHBET", GLFW_KEY_N, 2 }
    };
    for (int i = 0; i < 3; i++) {
        int codes[4] = { extra[i].key, 0, 0, 0 };
        NSMutableDictionary *b = createButton(@(extra[i].name), codes,
            [NSString stringWithFormat:@"0.02 * ${screen_width} + %d", extra[i].slot * 92],
            @"0.12 * ${screen_height}", 84.0, 34.0);
        b[@"cornerRadius"] = @(100);
        b[@"isToggle"] = @NO;
        b[@"isSwipeable"] = @NO;
        b[@"passThruEnabled"] = @NO;
        b[@"strokeColor"] = @(-1);
        b[@"strokeWidth"] = @(0);
        [list addObject:b];
    }
    saveJSONToFile(d, out);
}

#pragma mark - JIT

+ (void)startAltKitIfNeeded {
    if (@available(iOS 17.0, *)) { return; }
    if (!getEntitlementValue(@"get-task-allow") || isJITEnabled(false)) { return; }
    [ALTServerManager.sharedManager startDiscovering];
    [ALTServerManager.sharedManager autoconnectWithCompletionHandler:^(ALTServerConnection *connection, NSError *error) {
        if (error) {
            NSLog(@"[AltKit] Could not auto-connect to server. %@", error.localizedRecoverySuggestion);
            return;
        }
        [connection enableUnsignedCodeExecutionWithCompletionHandler:^(BOOL success, NSError *e2) {
            if (success) {
                NSLog(@"[AltKit] Successfully enabled JIT compilation!");
                [ALTServerManager.sharedManager stopDiscovering];
            } else {
                NSLog(@"[AltKit] Error enabling JIT: %@", e2.localizedRecoverySuggestion);
            }
            [connection disconnect];
        }];
    }];
}

/// same flow as LauncherNavigationController -invokeAfterJITEnabled: (StikDebug / SideStore / TrollStore / AltServer), then run handler
+ (void)afterJIT:(void (^)(void))handler {
    BOOL hasTrollStoreJIT = getEntitlementValue(@"jb.pmap_cs.custom_trust");
    if (isJITEnabled(false)) {
        [ALTServerManager.sharedManager stopDiscovering];
        handler();
        return;
    } else if (hasTrollStoreJIT) {
        NSURL *jitURL = [NSURL URLWithString:[NSString stringWithFormat:@"apple-magnifier://enable-jit?bundle-id=%@", NSBundle.mainBundle.bundleIdentifier]];
        [UIApplication.sharedApplication openURL:jitURL options:@{} completionHandler:nil];
    } else if (getPrefBool(@"debug.debug_skip_wait_jit")) {
        NSLog(@"Debug option skipped waiting for JIT. Java might not work.");
        handler();
        return;
    } else if (@available(iOS 17.4, *)) {
        NSString *scriptDataString = @"";
        if (DeviceHasJITFlags(JIT_FLAG_FORCE_MIRRORED | JIT_FLAG_HAS_TXM)) {
            NSData *scriptData = [NSData dataWithContentsOfFile:[NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"UniversalJIT26.js"]];
            scriptDataString = [@"&script-data=" stringByAppendingString:[scriptData base64EncodedStringWithOptions:0]];
        }
        [UIApplication.sharedApplication openURL:[NSURL URLWithString:[NSString stringWithFormat:@"stikjit://enable-jit?bundle-id=%@&pid=%d%@", NSBundle.mainBundle.bundleIdentifier, getpid(), scriptDataString]] options:@{} completionHandler:nil];
    } else {
        // 16.7 - 17.3.1: SideStore (AltServer users are handled by AltKit at startup)
        [UIApplication.sharedApplication openURL:[NSURL URLWithString:[NSString stringWithFormat:@"sidestore://sidejit-enable?pid=%d", getpid()]] options:@{} completionHandler:nil];
    }

    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"JIT bekleniyor"
        message:hasTrollStoreJIT ? @"TrollStore JIT'i açıyor, birazdan oyun başlayacak."
                                 : @"Oyun için JIT gerekli. StikDebug veya SideStore ile VanillaTurkey için JIT'i aç, ardından uygulamaya dön. JIT açılınca oyun kendiliğinden başlar."
        preferredStyle:UIAlertControllerStyleAlert];
    [currentVC() presentViewController:alert animated:YES completion:nil];

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        while (!isJITEnabled(false)) { usleep(1000 * 200); }
        dispatch_async(dispatch_get_main_queue(), ^{
            [alert dismissViewControllerAnimated:YES completion:handler];
        });
    });
}

#pragma mark - launch

/// extra game arguments (--quickPlayMultiplayer) go into the Fabric profile json: Amethyst's Java side builds the game command line from it
+ (void)applyQuickPlay:(NSString *)ip toVersion:(NSString *)vid {
    NSString *path = [NSString stringWithFormat:@"%@/versions/%@/%@.json", vtGameDir(), vid, vid];
    NSMutableDictionary *j = parseJSONFromFile(path);
    if (!j || j[@"NSErrorObject"]) { return; }
    NSMutableDictionary *args = [j[@"arguments"] isKindOfClass:NSDictionary.class] ? [j[@"arguments"] mutableCopy] : [NSMutableDictionary new];
    NSMutableArray *game = [NSMutableArray new];
    NSArray *old = [args[@"game"] isKindOfClass:NSArray.class] ? args[@"game"] : @[];
    for (NSUInteger i = 0; i < old.count; i++) {
        if ([old[i] isKindOfClass:NSString.class] && [old[i] isEqualToString:@"--quickPlayMultiplayer"]) { i++; continue; }
        [game addObject:old[i]];
    }
    if (ip.length) { [game addObject:@"--quickPlayMultiplayer"]; [game addObject:ip]; }
    args[@"game"] = game;
    if (!args[@"jvm"]) { args[@"jvm"] = @[]; }
    j[@"arguments"] = args;
    saveJSONToFile(j, path);
}

+ (void)launch:(NSDictionary *)a completion:(void (^)(NSDictionary *))completion {
    NSString *name = a[@"name"];
    NSString *username = a[@"username"];
    NSString *uuid = a[@"uuid"];
    if (![name isKindOfClass:NSString.class] || ![username isKindOfClass:NSString.class] || !gMetadata || ![gMetadataName isEqualToString:name]) {
        completion(@{ @"ok": @NO, @"error": @"Önce oyun kurulumu tamamlanmalı." });
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        unsetenv("DEMO_LOCK");
        // account: a "local" Amethyst account named like the VanillaTurkey user, carrying our offline uuid
        LocalAuthenticator *auth = [[LocalAuthenticator alloc] initWithInput:username];
        [auth loginWithCallback:^(id status, BOOL success) {}];
        if ([uuid isKindOfClass:NSString.class] && uuid.length) {
            auth.authData[@"profileId"] = uuid;
            [auth saveChanges];
        }
        BaseAuthenticator.current = auth;

        // profile: JVM flags (mobile mode for the mod), renderer, touch layout
        [self ensureControlLayout];
        NSMutableArray<NSString *> *jvm = [NSMutableArray new];
        for (id x in ([a[@"jvmArgs"] isKindOfClass:NSArray.class] ? a[@"jvmArgs"] : @[])) {
            if ([x isKindOfClass:NSString.class] && ![x hasPrefix:@"-Xm"]) { [jvm addObject:x]; }
        }
        [jvm addObject:@"-Dvt.ios=true"];
        setenv("VT_MOBILE", "1", 1);
        PLProfiles *p = PLProfiles.current;
        NSMutableDictionary *prof = [(NSDictionary *)p.profiles[name] mutableCopy];
        if (!prof) {
            completion(@{ @"ok": @NO, @"error": @"Profil bulunamadı." });
            return;
        }
        prof[@"javaArgs"] = [jvm componentsJoinedByString:@" "];
        NSString *renderer = a[@"renderer"];
        if ([renderer isKindOfClass:NSString.class] && renderer.length) { prof[@"renderer"] = renderer; } else { [prof removeObjectForKey:@"renderer"]; }
        if ([NSFileManager.defaultManager fileExistsAtPath:[vtAmeHome() stringByAppendingPathComponent:@"controlmap/vanillaturkey.json"]]) {
            prof[@"defaultTouchCtrl"] = @"vanillaturkey.json";
        }
        ((NSMutableDictionary *)p.profiles)[name] = prof;
        [p setSelectedProfileName:name];
        [self applyQuickPlay:[a[@"joinIp"] isKindOfClass:NSString.class] ? a[@"joinIp"] : @"" toVersion:prof[@"lastVersionId"]];

        [self afterJIT:^{
            UIKit_launchMinecraftSurfaceVC(UIWindow.mainWindow, gMetadata);
            completion(@{ @"ok": @YES });
        }];
    });
}

#pragma mark - renderers

+ (NSArray<NSDictionary *> *)renderers {
    return @[
        @{ @"id": @"libtinygl4angle.dylib", @"name": @"ANGLE (Metal)", @"summary": @"Çoğu iPhone için uyumlu, varsayılan." },
        @{ @"id": @"libmobileglues.dylib", @"name": @"MobileGlues (GL 4.x)", @"summary": @"Daha yeni OpenGL; Sodium (deneysel) için gerekli." },
        @{ @"id": @"libgl4es_114.dylib", @"name": @"GL4ES", @"summary": @"Eski, hafif. Bazı sürümlerde daha hızlı olabilir." },
        @{ @"id": @"libOSMesa.8.dylib", @"name": @"Zink (Vulkan / MoltenVK)", @"summary": @"Deneysel; güçlü cihazlarda." }
    ];
}

@end
