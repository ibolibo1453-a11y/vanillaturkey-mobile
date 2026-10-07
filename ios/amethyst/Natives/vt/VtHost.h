#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

/**
 * Owns the launcher UI: a WKWebView (the PC launcher React UI, built from mobile/ui with VT_PLATFORM=ios) served by VtServer.
 * It outlives the launcher view controller: when Minecraft starts, Amethyst replaces the window's root view controller and
 * frees the launcher, so the web view is parked as a tiny invisible subview of the window and keeps running (voice rooms,
 * chat, game bridge); when the game returns, it goes back into a fresh VtRootViewController.
 */
@interface VtHost : NSObject <WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate>

+ (VtHost *)shared;

@property (nonatomic, readonly) WKWebView *webView;
@property (atomic) BOOL pageReady;

/// starts the local server and creates the web view (idempotent)
- (void)prepare;
/// push an event to the JS side (window.__vtEvent). args must be JSON-serialisable.
- (void)emit:(NSString *)channel args:(NSArray *)args;
/// put the web view into a (new) container view, full size
- (void)attachToView:(UIView *)container;
/// keep it alive but invisible while the game owns the screen
- (void)parkInWindow:(UIWindow *)window;
/// path of the shipped UI inside the app bundle
+ (NSString *)webRoot;

@end

/// root view controller of the launcher: just hosts the web view
@interface VtRootViewController : UIViewController
@end
