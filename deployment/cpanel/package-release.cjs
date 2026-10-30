const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"../.."),web=path.join(root,"mobile/dist-production");
if(!fs.existsSync(path.join(web,"index.html")))throw new Error("Export the production web app first; see deployment/cpanel/README.md.");
const releases=path.join(root,"mobile/builds/production");
if(!fs.existsSync(path.join(releases,"release.json")))throw new Error("Build and verify the company-signed production APKs before packaging.");
const release=JSON.parse(fs.readFileSync(path.join(releases,"release.json"),"utf8"));
for(const [variant,filename] of Object.entries({agent:"CallTrack-Dialer-private.apk",admin:"CallTrack-CRM-private.apk"})){
 const metadata=release.apps?.[variant];
 if(metadata?.filename!==filename||metadata.signing!=="company"||metadata.apiUrl!=="https://erp.royalcleaning.com.np/api")throw new Error("Production APK metadata is incomplete or targets another API.");
 const bytes=fs.readFileSync(path.join(releases,filename));
 if(require("node:crypto").createHash("sha256").update(bytes).digest("hex")!==metadata.sha256)throw new Error("Production APK checksum mismatch.");
}
const label="royal-calltrack-"+new Date().toISOString().replace(/[^0-9]/g,"");
const base=path.join(root,"deployment/artifacts"),stage=path.join(base,label);fs.mkdirSync(stage,{recursive:true});
fs.copyFileSync(path.join(__dirname,"app.js"),path.join(stage,"app.js"));
fs.writeFileSync(path.join(stage,"package.json"),JSON.stringify({name:"royal-calltrack-private",private:true,type:"commonjs",engines:{node:">=22.13.0"},scripts:{start:"node app.js"}},null,2));
const server=path.join(stage,"server");fs.mkdirSync(server);
for(const file of ["index.js","app.js","package.json","package-lock.json",".env.example"])fs.copyFileSync(path.join(root,"server",file),path.join(server,file));
for(const folder of ["config","middleware","models","routes","services","sockets","utils"])fs.cpSync(path.join(root,"server",folder),path.join(server,folder),{recursive:true});
fs.mkdirSync(path.join(server,"scripts"));
for(const file of ["seed.js","migrate-call-center.js","checkDatabase.js","backupDatabase.js","scheduled-maintenance.js","enable-agent-customers.js"])if(fs.existsSync(path.join(root,"server/scripts",file)))fs.copyFileSync(path.join(root,"server/scripts",file),path.join(server,"scripts",file));
fs.cpSync(web,path.join(stage,"web"),{recursive:true});
fs.mkdirSync(path.join(stage,"private-releases"));
for(const filename of ["release.json","CallTrack-Dialer-private.apk","CallTrack-CRM-private.apk"])fs.copyFileSync(path.join(releases,filename),path.join(stage,"private-releases",filename));
fs.copyFileSync(path.join(__dirname,"app.env.example"),path.join(stage,"app.env.example"));
const archive=path.join(base,label+".tar.gz");
const result=spawnSync(process.platform==="win32"?"tar.exe":"tar",["-czf",archive,"-C",stage,"."],{encoding:"utf8"});
if(result.status!==0)throw new Error("Archive failed; staged files remain at "+stage);
fs.writeFileSync(archive+".sha256",require("node:crypto").createHash("sha256").update(fs.readFileSync(archive)).digest("hex")+"  "+path.basename(archive)+"\n");
console.log("Private cPanel package: "+archive);console.log("No database credentials, signing keys, or node_modules are included.");

