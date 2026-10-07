#import "VtHost.h"
#import "VtServer.h"
#import "VtRpc.h"
#import "VtGame.h"
#import <AVFoundation/AVFoundation.h>
#import "../utils.h"

@interface VtHost ()
@property (nonatomic, readwrite) WKWebView *webView;
@end

static NSString *vtJSLiteral(NSString *s) {
    // a JSON string literal is a valid JS string literal
    NSData *d = [NSJSONSerialization dataWithJSONObject:@[s ?: @""] options:0 error:nil];
    NSString *arr = [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding];
    if (arr.length < 2) { return @"\"\""; }
    return [arr substringWithRange:NSMakeRange(1, arr.length - 2)];
}

@implementation VtHost

+ (VtHost *)shared {
    static VtHost *h;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ h = [VtHost new]; });
    return h;
}

+ (NSString *)webRoot {
    return [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"vtui"];
}

- (void)prepare {
    if (self.webView) { return; }
    VtServer *srv = VtServer.shared;
    __weak VtHost *weakSelf = self;
    srv.emit = ^(NSString *ch, NSArray *args) { [weakSelf emit:ch args:args]; };
    BOOL ok = [srv startWithWebRoot:VtHost.webRoot];
    NSLog(@"[VT] server %@ on port %d (web root %@)", ok ? @"started" : @"FAILED", srv.port, VtHost.webRoot);

    WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
    cfg.allowsInlineMediaPlayback = YES;
    cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    cfg.applicationNameForUserAgent = @"VanillaTurkeyMobile/1 (iOS)";
    [cfg.userContentController addScriptMessageHandler:self name:@"vt"];
    WKWebView *wv = [[WKWebView alloc] initWithFrame:UIScreen.mainScreen.bounds configuration:cfg];
    wv.navigationDelegate = self;
    wv.UIDelegate = self;
    wv.opaque = NO;
    wv.backgroundColor = [UIColor colorWithRed:0x6F / 255.0 green:0x9B / 255.0 blue:0xD6 / 255.0 alpha:1];
    wv.scrollView.backgroundColor = wv.backgroundColor;
    wv.scrollView.bounces = NO;
    wv.scrollView.showsVerticalScrollIndicator = NO;
    wv.scrollView.showsHorizontalScrollIndicator = NO;
    wv.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    wv.allowsLinkPreview = NO;
    self.webView = wv;
    [self loadUI];
}

- (void)loadUI {
    self.pageReady = NO;
    NSURL *u = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d/index.html", VtServer.shared.port]];
    [self.webView loadRequest:[NSURLRequest requestWithURL:u cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:20]];
}

- (void)emit:(NSString *)channel args:(NSArray *)args {
    NSArray *a = args ?: @[];
    NSData *d = [NSJSONSerialization dataWithJSONObject:a options:0 error:nil];
    NSString *json = d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"[]";
    NSString *js = [NSString stringWithFormat:@"window.__vtEvent&&window.__vtEvent(%@,%@)", vtJSLiteral(channel), vtJSLiteral(json)];
    [self eval:js];
}

- (void)eval:(NSString *)js {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.webView evaluateJavaScript:js completionHandler:nil];
    });
}

#pragma mark - view hosting

- (void)attachToView:(UIView *)container {
    UIView *wv = self.webView;
    if (!wv) { return; }
    if (wv.superview != container) {
        [wv removeFromSuperview];
        [container addSubview:wv];
    }
    wv.alpha = 1;
    wv.userInteractionEnabled = YES;
    wv.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    if (!CGRectEqualToRect(wv.frame, container.bounds)) { wv.frame = container.bounds; }
}

- (void)parkInWindow:(UIWindow *)window {
    UIView *wv = self.webView;
    if (!wv || !window) { return; }
    [wv removeFromSuperview];
    wv.autoresizingMask = UIViewAutoresizingNone;
    wv.frame = CGRectMake(0, 0, 1, 1);
    wv.alpha = 0.02; // not hidden / alpha 0: WebKit throttles timers of invisible views and the voice loop must keep running
    wv.userInteractionEnabled = NO;
    [window addSubview:wv];
}

#pragma mark - JS -> native

- (void)userContentController:(WKUserContentController *)ucc didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:NSDictionary.class]) { return; }
    NSDictionary *b = message.body;
    NSNumber *cid = b[@"id"];
    NSString *name = b[@"name"];
    NSString *argsJson = b[@"args"];
    if (![cid isKindOfClass:NSNumber.class] || ![name isKindOfClass:NSString.class]) { return; }
    NSDictionary *args = @{};
    if ([argsJson isKindOfClass:NSString.class] && argsJson.length) {
        id o = [NSJSONSerialization JSONObjectWithData:[argsJson dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if ([o isKindOfClass:NSDictionary.class]) { args = o; }
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        [VtRpc dispatch:name args:args completion:^(id result, NSString *error) {
            NSString *json;
            if (error) {
                json = vtJSLiteral(error);
            } else if (result == nil || result == NSNull.null) {
                json = @"null";
            } else {
                NSData *d = [NSJSONSerialization dataWithJSONObject:@[result] options:0 error:nil];
                NSString *arr = d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : nil;
                json = arr.length >= 2 ? [arr substringWithRange:NSMakeRange(1, arr.length - 2)] : @"null";
            }
            NSString *js = [NSString stringWithFormat:@"window.__vtResult&&window.__vtResult(%@,%@,%@)", cid, error ? @"false" : @"true", vtJSLiteral(json)];
            [self eval:js];
        }];
    });
}

#pragma mark - navigation / UI delegates

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *u = action.request.URL;
    NSString *host = u.host.lowercaseString;
    if ([u.scheme isEqualToString:@"about"] || [host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"]) {
        handler(WKNavigationActionPolicyAllow);
        return;
    }
    if ([u.scheme isEqualToString:@"https"] || [u.scheme isEqualToString:@"mailto"]) {
        dispatch_async(dispatch_get_main_queue(), ^{ [UIApplication.sharedApplication openURL:u options:@{} completionHandler:nil]; });
    }
    handler(WKNavigationActionPolicyCancel);
}

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    NSURL *u = action.request.URL;
    if ([u.scheme isEqualToString:@"https"]) {
        dispatch_async(dispatch_get_main_queue(), ^{ [UIApplication.sharedApplication openURL:u options:@{} completionHandler:nil]; });
    }
    return nil;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    NSLog(@"[VT] UI page loaded");
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"[VT] UI load failed: %@", error.localizedDescription);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [self loadUI]; });
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    NSLog(@"[VT] web content process terminated, reloading UI");
    VtServer.shared.rendererReady = NO;
    [self loadUI];
}

// microphone for voice rooms (getUserMedia): our own local origin only
- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(ios(15.0)) {
    BOOL local = [origin.host isEqualToString:@"127.0.0.1"] || [origin.host isEqualToString:@"localhost"];
    if (!local || type == WKMediaCaptureTypeCamera) {
        decisionHandler(WKPermissionDecisionDeny);
        return;
    }
    [AVAudioSession.sharedInstance requestRecordPermission:^(BOOL granted) {
        dispatch_async(dispatch_get_main_queue(), ^{
            decisionHandler(granted ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
        });
    }];
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    completionHandler();
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    completionHandler(YES);
}

@end

#pragma mark - root view controller

@implementation VtRootViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0x6F / 255.0 green:0x9B / 255.0 blue:0xD6 / 255.0 alpha:1];
    [VtHost.shared prepare];
    [VtGame startAltKitIfNeeded];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    [VtHost.shared attachToView:self.view];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [VtHost.shared attachToView:self.view];
}

- (BOOL)prefersStatusBarHidden { return NO; }
- (BOOL)prefersHomeIndicatorAutoHidden { return NO; }
- (UIInterfaceOrientationMask)supportedInterfaceOrientations { return UIInterfaceOrientationMaskAll; }

@end
