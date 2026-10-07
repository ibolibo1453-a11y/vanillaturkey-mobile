#import <Foundation/Foundation.h>

/**
 * Game pipeline glue between the web UI (mobile/ui/src/native/game.ts) and Amethyst's native installer / JVM launcher:
 *  game.dir     -> profile directory (mods, options.txt, vtclient/session.json live here; it is the JVM's user.dir)
 *  game.ensure  -> Fabric loader profile json + Minecraft client/libraries/assets (Amethyst's MinecraftResourceDownloadTask)
 *  game.launch  -> account + profile + (JIT wait) + UIKit_launchMinecraftSurfaceVC
 */
@interface VtGame : NSObject

+ (NSString *)gameHome;                                  // AME_HOME/instances/<game_directory>
+ (NSString *)profileDirForName:(NSString *)name;        // gameHome/vt/<name>
+ (void)ensureName:(NSString *)name mc:(NSString *)mc
          progress:(void (^)(double pct, NSString *text))progress
        completion:(void (^)(NSString *error))completion;
+ (void)launch:(NSDictionary *)args completion:(void (^)(NSDictionary *result))completion;
+ (NSArray<NSDictionary *> *)renderers;
/// iOS < 17 sideloaded with AltStore: ask AltServer to enable JIT in the background
+ (void)startAltKitIfNeeded;

@end
