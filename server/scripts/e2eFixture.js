import {randomBytes} from "node:crypto";
﻿// Isolated browser test database. This never uses MONGODB_URI.
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import {createServer} from "node:http";
import {connectDatabase,disconnectDatabase} from "../config/database.js";
const mongo=await MongoMemoryServer.create({instance: { launchTimeout: 120000, args:process.platform==="win32"?[]:["--nounixsocket"]}});
await connectDatabase(mongo.getUri("browser_e2e"));
const models=await import("../models/index.js");
await models.ensureIndexes();
const companyId=new mongoose.Types.ObjectId();
await models.Settings.create({_id:companyId,companyId,name:"Royal Cleaning Services · Test",timezone:"Asia/Kathmandu"});
const passwordHash=await bcrypt.hash("Browser-fixture-password-123!",4);
await models.User.create({companyId,fullName:"Test Administrator",email:"admin@browser.test",agentCode:"ADMIN",role:"admin",passwordHash});
const agent=await models.User.create({companyId,fullName:"Test Agent",email:"agent@browser.test",agentCode:"A01",role:"agent",passwordHash});
await models.User.create({companyId,fullName:"Test Supervisor",email:"supervisor@browser.test",agentCode:"S01",role:"supervisor",passwordHash,supervisedAgentIds:[agent._id]});
for(let i=0;i<3;i++){
const c=await models.Customer.create({companyId,fullName:"Cleaning Customer "+(i+1),phone:"+97798000000"+String(10+i),serviceType:"Home cleaning"});
await models.Lead.create({companyId,customerId:c._id,assignedAgentId:agent._id,assignedAt:new Date(),status:"Assigned"});
}
const {createApp}=await import("../app.js"),{setupLive}=await import("../sockets/live.js");
const config={recordingEncryptionKey:randomBytes(32).toString("hex"),recordingDirectory:"D:/CallTrackBuild/browser-fixture-audio",nodeEnv:"test",jwtSecret:"browser-fixture-secret-at-least-32-characters",callMode:"sim",origins:["http://localhost:8082","http://localhost:8081"]};
const app=createApp({config,isDatabaseReady:()=>true}),server=createServer(app),live=setupLive(server,config);app.locals.live=live;
server.listen(5001,"127.0.0.1",()=>console.log("Isolated fixture ready on 5001"));
async function stop(){live.close?.();server.close();await disconnectDatabase();await mongo.stop();process.exit(0);}
process.on("SIGINT",stop);process.on("SIGTERM",stop);

