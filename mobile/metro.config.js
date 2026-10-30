// Standalone app: ignore unrelated workspace lockfiles at the drive root.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = "1";
(function metroConfig(){
 const {getDefaultConfig}=require("expo/metro-config"),path=require("node:path");
 const config=getDefaultConfig(__dirname);
 // Public build targets must participate in Metro's transform cache key.
 // Otherwise an environment-only URL change can reuse the previous bundle.
 config.cacheVersion=[config.cacheVersion,process.env.EXPO_PUBLIC_API_URL||"default"].filter(Boolean).join(":");
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 const generated=["android","ios","builds","dist","dist-review","dist-ios-check","dist-production","dist-local","modules/calltrack-telecom/android"];
 const existing=config.resolver.blockList;
 config.resolver.blockList=[...(Array.isArray(existing)?existing:existing?[existing]:[]),...generated.map(folder=>new RegExp("^"+path.resolve(__dirname,folder).split(/[\\/]/).map(escape).join("[\\\\/]")+"(?:[\\\\/].*)?$"))];
 module.exports=config;
})();
