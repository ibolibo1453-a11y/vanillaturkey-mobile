#import "VtServer.h"
#import <CommonCrypto/CommonDigest.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

#define VT_PREFERRED_PORT 38417
#define VT_MAX_FRAME (8 * 1024 * 1024)

#pragma mark - small socket helpers

static BOOL vtReadExact(int fd, void *buf, size_t n) {
    uint8_t *p = (uint8_t *)buf;
    while (n > 0) {
        ssize_t r = recv(fd, p, n, 0);
        if (r < 0 && errno == EINTR) { continue; }
        if (r <= 0) { return NO; }
        p += r;
        n -= (size_t)r;
    }
    return YES;
}

static BOOL vtWriteAll(int fd, const void *buf, size_t n) {
    const uint8_t *p = (const uint8_t *)buf;
    while (n > 0) {
        ssize_t w = send(fd, p, n, 0);
        if (w < 0 && errno == EINTR) { continue; }
        if (w <= 0) { return NO; }
        p += w;
        n -= (size_t)w;
    }
    return YES;
}

static NSString *vtMime(NSString *ext) {
    static NSDictionary *m;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        m = @{
            @"html": @"text/html; charset=utf-8", @"js": @"text/javascript; charset=utf-8", @"mjs": @"text/javascript; charset=utf-8",
            @"css": @"text/css; charset=utf-8", @"json": @"application/json; charset=utf-8", @"png": @"image/png",
            @"jpg": @"image/jpeg", @"jpeg": @"image/jpeg", @"webp": @"image/webp", @"gif": @"image/gif", @"svg": @"image/svg+xml",
            @"woff": @"font/woff", @"woff2": @"font/woff2", @"ttf": @"font/ttf", @"otf": @"font/otf", @"wasm": @"application/wasm",
            @"mp3": @"audio/mpeg", @"ogg": @"audio/ogg", @"wav": @"audio/wav", @"mp4": @"video/mp4", @"txt": @"text/plain; charset=utf-8",
            @"glb": @"model/gltf-binary", @"gltf": @"model/gltf+json", @"ico": @"image/x-icon", @"map": @"application/json"
        };
    });
    return m[ext.lowercaseString] ?: @"application/octet-stream";
}

#pragma mark - client

@interface VtClient : NSObject
@property (nonatomic) int fd;
@property (nonatomic) NSNumber *cid;
@property (nonatomic) BOOL authed;
@property (nonatomic) BOOL closed;
@property (nonatomic) NSLock *wlock;
@end
@implementation VtClient
@end

#pragma mark - server

@interface VtServer () {
    int _listenFd;
    NSString *_webRoot;
    NSMutableDictionary<NSNumber *, VtClient *> *_clients;
    int _nextId;
}
@property (nonatomic, readwrite) int port;
@property (nonatomic, readwrite, copy) NSString *token;
@end

@implementation VtServer

+ (VtServer *)shared {
    static VtServer *s;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ s = [VtServer new]; });
    return s;
}

- (instancetype)init {
    self = [super init];
    _clients = [NSMutableDictionary new];
    _nextId = 1;
    _listenFd = -1;
    uint8_t rnd[24];
    arc4random_buf(rnd, sizeof(rnd));
    NSMutableString *t = [NSMutableString new];
    for (int i = 0; i < 24; i++) { [t appendFormat:@"%02x", rnd[i]]; }
    _token = [t copy];
    return self;
}

- (int)bindOnPort:(int)port {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { return -1; }
    int yes = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
    struct sockaddr_in a;
    memset(&a, 0, sizeof(a));
    a.sin_len = sizeof(a);
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(fd, (struct sockaddr *)&a, sizeof(a)) != 0 || listen(fd, 16) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

- (BOOL)startWithWebRoot:(NSString *)root {
    @synchronized (self) {
        if (_listenFd >= 0) { return YES; }
        _webRoot = [root copy];
        // fixed port first: the WebView origin (localStorage, IndexedDB, mic permission) stays the same between launches
        int fd = [self bindOnPort:VT_PREFERRED_PORT];
        if (fd < 0) { fd = [self bindOnPort:0]; }
        if (fd < 0) { return NO; }
        struct sockaddr_in a;
        socklen_t len = sizeof(a);
        getsockname(fd, (struct sockaddr *)&a, &len);
        self.port = ntohs(a.sin_port);
        _listenFd = fd;
    }
    NSThread *th = [[NSThread alloc] initWithTarget:self selector:@selector(acceptLoop) object:nil];
    th.name = @"vt-server-accept";
    [th start];
    return YES;
}

- (void)acceptLoop {
    int lfd = _listenFd;
    while (YES) {
        struct sockaddr_in a;
        socklen_t len = sizeof(a);
        int fd = accept(lfd, (struct sockaddr *)&a, &len);
        if (fd < 0) {
            if (errno == EINTR) { continue; }
            usleep(100 * 1000);
            continue;
        }
        int yes = 1;
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            [self handleConnection:fd];
        });
    }
}

#pragma mark - HTTP

- (NSData *)readHead:(int)fd {
    NSMutableData *buf = [NSMutableData new];
    uint8_t c;
    while (buf.length < 16384) {
        ssize_t r = recv(fd, &c, 1, 0);
        if (r < 0 && errno == EINTR) { continue; }
        if (r <= 0) { return nil; }
        [buf appendBytes:&c length:1];
        NSUInteger n = buf.length;
        if (n >= 4) {
            const uint8_t *b = buf.bytes;
            if (b[n - 4] == '\r' && b[n - 3] == '\n' && b[n - 2] == '\r' && b[n - 1] == '\n') { return buf; }
        }
    }
    return nil;
}

- (void)respond:(int)fd status:(int)code reason:(NSString *)reason type:(NSString *)type body:(NSData *)body {
    NSString *head = [NSString stringWithFormat:@"HTTP/1.1 %d %@\r\nContent-Type: %@\r\nContent-Length: %lu\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
                      code, reason, type, (unsigned long)body.length];
    NSData *h = [head dataUsingEncoding:NSUTF8StringEncoding];
    vtWriteAll(fd, h.bytes, h.length);
    if (body.length) { vtWriteAll(fd, body.bytes, body.length); }
}

- (void)handleConnection:(int)fd {
    NSData *head = [self readHead:fd];
    if (!head) { close(fd); return; }
    NSString *text = [[NSString alloc] initWithData:head encoding:NSUTF8StringEncoding];
    if (!text) { text = [[NSString alloc] initWithData:head encoding:NSISOLatin1StringEncoding]; }
    NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\r\n"];
    NSArray<NSString *> *first = [lines.firstObject componentsSeparatedByString:@" "];
    if (first.count < 2) { close(fd); return; }
    NSString *method = first[0];
    NSString *target = first[1];
    NSMutableDictionary<NSString *, NSString *> *hdr = [NSMutableDictionary new];
    for (NSUInteger i = 1; i < lines.count; i++) {
        NSString *ln = lines[i];
        NSRange r = [ln rangeOfString:@":"];
        if (r.location == NSNotFound) { continue; }
        NSString *k = [[ln substringToIndex:r.location] lowercaseString];
        NSString *v = [[ln substringFromIndex:r.location + 1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        hdr[k] = v;
    }
    if ([hdr[@"upgrade"].lowercaseString isEqualToString:@"websocket"]) {
        [self handleWebSocket:fd target:target headers:hdr];
        return;
    }
    if (![method isEqualToString:@"GET"] && ![method isEqualToString:@"HEAD"]) {
        [self respond:fd status:405 reason:@"Method Not Allowed" type:@"text/plain" body:[@"405" dataUsingEncoding:NSUTF8StringEncoding]];
        close(fd);
        return;
    }
    NSString *path = target;
    NSRange q = [path rangeOfString:@"?"];
    if (q.location != NSNotFound) { path = [path substringToIndex:q.location]; }
    path = [path stringByRemovingPercentEncoding] ?: @"/";
    if ([path hasSuffix:@"/"]) { path = [path stringByAppendingString:@"index.html"]; }
    NSArray<NSString *> *parts = [path componentsSeparatedByString:@"/"];
    for (NSString *p in parts) {
        if ([p isEqualToString:@".."] || [p containsString:@"\\"]) {
            [self respond:fd status:403 reason:@"Forbidden" type:@"text/plain" body:[@"403" dataUsingEncoding:NSUTF8StringEncoding]];
            close(fd);
            return;
        }
    }
    NSString *file = [_webRoot stringByAppendingPathComponent:path];
    BOOL isDir = NO;
    NSData *data = nil;
    if ([NSFileManager.defaultManager fileExistsAtPath:file isDirectory:&isDir] && !isDir) {
        data = [NSData dataWithContentsOfFile:file options:NSDataReadingMappedIfSafe error:nil];
    }
    if (!data) {
        [self respond:fd status:404 reason:@"Not Found" type:@"text/plain" body:[@"404" dataUsingEncoding:NSUTF8StringEncoding]];
    } else if ([method isEqualToString:@"HEAD"]) {
        NSString *h = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: %@\r\nContent-Length: %lu\r\nConnection: close\r\n\r\n", vtMime(file.pathExtension), (unsigned long)data.length];
        NSData *hd = [h dataUsingEncoding:NSUTF8StringEncoding];
        vtWriteAll(fd, hd.bytes, hd.length);
    } else {
        [self respond:fd status:200 reason:@"OK" type:vtMime(file.pathExtension) body:data];
    }
    close(fd);
}

#pragma mark - WebSocket (bridge)

- (BOOL)tokenOK:(id)tv {
    if (![tv isKindOfClass:NSString.class]) { return NO; }
    NSString *t = tv;
    if (t.length == 0 || t.length != _token.length) { return NO; }
    const char *a = t.UTF8String;
    const char *b = _token.UTF8String;
    unsigned char diff = 0;
    for (size_t i = 0; i < strlen(b); i++) { diff |= (unsigned char)(a[i] ^ b[i]); }
    return diff == 0;
}

- (BOOL)sendFrame:(VtClient *)c opcode:(uint8_t)op payload:(NSData *)payload {
    NSMutableData *f = [NSMutableData new];
    uint8_t b0 = 0x80 | (op & 0x0F);
    [f appendBytes:&b0 length:1];
    NSUInteger n = payload.length;
    if (n < 126) {
        uint8_t l = (uint8_t)n;
        [f appendBytes:&l length:1];
    } else if (n <= 0xFFFF) {
        uint8_t l[3] = { 126, (uint8_t)(n >> 8), (uint8_t)(n & 0xFF) };
        [f appendBytes:l length:3];
    } else {
        uint8_t l[9];
        l[0] = 127;
        for (int i = 0; i < 8; i++) { l[1 + i] = (uint8_t)(((uint64_t)n >> (56 - 8 * i)) & 0xFF); }
        [f appendBytes:l length:9];
    }
    [f appendData:payload];
    [c.wlock lock];
    BOOL ok = c.closed ? NO : vtWriteAll(c.fd, f.bytes, f.length);
    [c.wlock unlock];
    return ok;
}

- (void)sendJSON:(NSDictionary *)d to:(VtClient *)c {
    NSData *j = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
    if (j) { [self sendFrame:c opcode:1 payload:j]; }
}

- (void)closeClient:(VtClient *)c code:(uint16_t)code {
    [c.wlock lock];
    if (!c.closed) {
        uint8_t f[4] = { 0x88, 2, (uint8_t)(code >> 8), (uint8_t)(code & 0xFF) };
        vtWriteAll(c.fd, f, 4);
        c.closed = YES;
        shutdown(c.fd, SHUT_RDWR);
    }
    [c.wlock unlock];
}

- (BOOL)authClient:(VtClient *)c token:(id)t {
    if (![self tokenOK:t]) { return NO; }
    c.authed = YES;
    @synchronized (self) { _clients[c.cid] = c; }
    [self sendJSON:@{ @"t": @"ready", @"version": @1, @"launcher": @"ios", @"social": @(self.rendererReady) } to:c];
    if (self.emit) { self.emit(@"bridge:open", @[c.cid]); }
    return YES;
}

- (NSString *)acceptKeyFor:(NSString *)key {
    NSString *src = [key stringByAppendingString:@"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"];
    NSData *sd = [src dataUsingEncoding:NSUTF8StringEncoding];
    uint8_t dg[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(sd.bytes, (CC_LONG)sd.length, dg);
    return [[NSData dataWithBytes:dg length:CC_SHA1_DIGEST_LENGTH] base64EncodedStringWithOptions:0];
}

- (void)handleWebSocket:(int)fd target:(NSString *)target headers:(NSDictionary<NSString *, NSString *> *)hdr {
    // browsers (and web pages) always send an Origin: only the game's own client is allowed
    NSString *key = hdr[@"sec-websocket-key"];
    if (hdr[@"origin"] != nil || key.length == 0) {
        [self respond:fd status:403 reason:@"Forbidden" type:@"text/plain" body:[@"origin" dataUsingEncoding:NSUTF8StringEncoding]];
        close(fd);
        return;
    }
    NSString *resp = [NSString stringWithFormat:@"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %@\r\n\r\n", [self acceptKeyFor:key]];
    NSData *rd = [resp dataUsingEncoding:NSUTF8StringEncoding];
    if (!vtWriteAll(fd, rd.bytes, rd.length)) { close(fd); return; }

    VtClient *c = [VtClient new];
    c.fd = fd;
    c.wlock = [NSLock new];
    @synchronized (self) { c.cid = @(_nextId++); }

    NSString *qtoken = nil;
    NSRange qr = [target rangeOfString:@"?"];
    if (qr.location != NSNotFound) {
        NSURLComponents *uc = [NSURLComponents componentsWithString:[@"http://x/?" stringByAppendingString:[target substringFromIndex:qr.location + 1]]];
        for (NSURLQueryItem *it in uc.queryItems) {
            if ([it.name isEqualToString:@"token"]) { qtoken = it.value; }
        }
    }
    NSString *auth = hdr[@"authorization"];
    if (qtoken.length == 0 && [auth hasPrefix:@"Bearer "]) {
        qtoken = [[auth substringFromIndex:7] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    }
    if (qtoken.length) { [self authClient:c token:qtoken]; }

    NSMutableData *msgBuf = [NSMutableData new];
    while (YES) {
        uint8_t h2[2];
        if (!vtReadExact(fd, h2, 2)) { break; }
        BOOL fin = (h2[0] & 0x80) != 0;
        uint8_t op = h2[0] & 0x0F;
        BOOL masked = (h2[1] & 0x80) != 0;
        uint64_t len = h2[1] & 0x7F;
        if (len == 126) {
            uint8_t e[2];
            if (!vtReadExact(fd, e, 2)) { break; }
            len = ((uint64_t)e[0] << 8) | e[1];
        } else if (len == 127) {
            uint8_t e[8];
            if (!vtReadExact(fd, e, 8)) { break; }
            len = 0;
            for (int i = 0; i < 8; i++) { len = (len << 8) | e[i]; }
        }
        if (len > VT_MAX_FRAME) { break; }
        uint8_t mask[4] = { 0, 0, 0, 0 };
        if (masked && !vtReadExact(fd, mask, 4)) { break; }
        NSMutableData *payload = [NSMutableData dataWithLength:(NSUInteger)len];
        if (len > 0 && !vtReadExact(fd, payload.mutableBytes, (size_t)len)) { break; }
        if (masked) {
            uint8_t *pb = payload.mutableBytes;
            for (uint64_t i = 0; i < len; i++) { pb[i] ^= mask[i & 3]; }
        }
        if (op == 8) { break; }
        if (op == 9) { [self sendFrame:c opcode:10 payload:payload]; continue; }
        if (op == 10) { continue; }
        if (op == 1 || op == 2 || op == 0) {
            [msgBuf appendData:payload];
            if (msgBuf.length > VT_MAX_FRAME) { break; }
            if (!fin) { continue; }
            NSData *whole = [msgBuf copy];
            [msgBuf setLength:0];
            id obj = [NSJSONSerialization JSONObjectWithData:whole options:0 error:nil];
            if (![obj isKindOfClass:NSDictionary.class]) { continue; }
            NSDictionary *m = obj;
            NSString *t = [m[@"t"] isKindOfClass:NSString.class] ? m[@"t"] : @"";
            if (t.length == 0) { continue; }
            if (!c.authed) {
                if (([t isEqualToString:@"hello"] || [t isEqualToString:@"auth"]) && [self authClient:c token:m[@"token"]]) { continue; }
                [self closeClient:c code:4001];
                break;
            }
            if ([t isEqualToString:@"ping"]) { [self sendJSON:@{ @"t": @"pong" } to:c]; continue; }
            if ([t isEqualToString:@"focus"]) { self.gameFocused = [m[@"on"] boolValue]; }
            if (!self.rendererReady) {
                [self sendJSON:@{ @"t": @"offline", @"reason": @"Launcher oturumu açık değil. Launcher'da giriş yap." } to:c];
                continue;
            }
            if (self.emit) { self.emit(@"bridge:msg", @[c.cid, m]); }
        }
    }
    BOOL wasAuthed = c.authed;
    [c.wlock lock];
    c.closed = YES;
    [c.wlock unlock];
    @synchronized (self) {
        if (c.cid) { [_clients removeObjectForKey:c.cid]; }
        if (_clients.count == 0) { self.gameFocused = NO; }
    }
    close(fd);
    if (wasAuthed && self.emit) { self.emit(@"bridge:close", @[c.cid]); }
}

- (void)sendMessage:(NSDictionary *)msg toClient:(NSNumber *)clientId {
    NSArray<VtClient *> *targets;
    @synchronized (self) {
        if (clientId) {
            VtClient *c = _clients[clientId];
            targets = c ? @[c] : @[];
        } else {
            targets = _clients.allValues;
        }
    }
    for (VtClient *c in targets) { [self sendJSON:msg to:c]; }
}

- (NSInteger)clientCount {
    @synchronized (self) { return (NSInteger)_clients.count; }
}

@end
