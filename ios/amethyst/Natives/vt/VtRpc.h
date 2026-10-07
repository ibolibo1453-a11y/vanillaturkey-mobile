#import <Foundation/Foundation.h>

typedef void (^VtRpcDone)(id result, NSString *error);

/**
 * Native side of window.VTAndroid.call(id, name, args) for iOS (mobile/ui/src/native/native.ts, `webkit.messageHandlers.vt`).
 * Same call names and result shapes as the Android implementation (VtNative.kt) so mobile/ui/src/native/*.ts is shared.
 */
@interface VtRpc : NSObject
+ (void)dispatch:(NSString *)name args:(NSDictionary *)args completion:(VtRpcDone)done;
/// AME_HOME/vt: launcher state (caches, skins, picked files)
+ (NSString *)root;
@end
