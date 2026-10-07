#import <Foundation/Foundation.h>

/**
 * VanillaTurkey local server (127.0.0.1 only), one listening socket for two jobs:
 *  1. static files of the launcher UI (bundle/vtui) -> the WKWebView loads http://127.0.0.1:<port>/ (a secure context, so
 *     getUserMedia / LiveKit work and window.fetch of relative assets just works);
 *  2. the launcher <-> game bridge WebSocket (plans/BRIDGE.md): ws://127.0.0.1:<port>/?token=<token>, same protocol the
 *     PC launcher (electron/social.ts) and the Android app (VtBridge.kt) serve. The brain (SocialClient, LiveKit, mic)
 *     is the JS in the WebView; this class only relays frames.
 */
@interface VtServer : NSObject

+ (VtServer *)shared;

@property (nonatomic, readonly) int port;
@property (nonatomic, readonly, copy) NSString *token;
/// set by JS (bridge.ready) once the launcher UI is signed in and its social client runs
@property (atomic) BOOL rendererReady;
/// game window focus as reported by the mod ({t:"focus", on})
@property (atomic) BOOL gameFocused;
/// called for events that must reach the JS side: ("bridge:open", @[id]), ("bridge:msg", @[id, dict]), ("bridge:close", @[id])
@property (nonatomic, copy) void (^emit)(NSString *channel, NSArray *args);

/// root: directory with index.html. Returns NO when no port could be bound.
- (BOOL)startWithWebRoot:(NSString *)root;
/// clientId == nil -> broadcast
- (void)sendMessage:(NSDictionary *)msg toClient:(NSNumber *)clientId;
- (NSInteger)clientCount;

@end
