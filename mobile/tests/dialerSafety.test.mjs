import test from "node:test";
import assert from "node:assert/strict";
import {attemptMatches,sameCallDraft,reportIdentity} from "../services/dialerSafety.mjs";
const attempt={attemptId:"attempt-1",reservationId:"reservation-1",phone:"+9779851239227",preparedAt:"2026-10-29T04:00:00Z"};
const event={callId:"native-1",direction:"outgoing",phone:"9851239227",startedAt:"2026-10-29T04:00:05Z"};
test("incoming call cannot claim an outgoing power attempt even for the same number",()=>{assert.equal(attemptMatches({...event,direction:"incoming"},attempt),false);});
test("older and late unrelated calls cannot consume an unbound reservation",()=>{assert.equal(attemptMatches({...event,startedAt:"2026-10-29T03:59:00Z"},attempt),false);assert.equal(attemptMatches({...event,startedAt:"2026-10-30T04:00:00Z"},attempt),false);assert.equal(attemptMatches(event,attempt),true);});
test("native UUID association rejects a different attempt and stays attached after delayed delivery",()=>{assert.equal(attemptMatches({...event,attemptId:"other"},attempt),false);assert.equal(attemptMatches({...event,attemptId:"attempt-1",reservationId:"reservation-1",startedAt:"2026-10-30T04:00:00Z"},attempt),true);assert.equal(attemptMatches({...event,callId:"other-native"},{...attempt,deviceCallId:"native-1"}),false);});
test("reopening native or server call reuses the existing power draft identity",()=>{const draft={reportId:"attempt-1",attemptId:"attempt-1",reservationId:"reservation-1",device:{callId:"native-1"}};assert(sameCallDraft(draft,{_id:"server-1",deviceCallId:"native-1"}));assert(sameCallDraft(draft,{_id:"server-1",attemptId:"attempt-1"}));assert.equal(reportIdentity({attemptId:"attempt-1",deviceCallId:"native-1"}),"attempt-1");assert.equal(reportIdentity({reportKey:"saved-1",attemptId:"attempt-1"}),"saved-1");});
test("another call to the same number remains a distinct report",()=>{assert.equal(sameCallDraft({phone:"+9779851239227",device:{callId:"native-1"},attemptId:"attempt-1"},{_id:"server-2",phone:"+9779851239227",deviceCallId:"native-2",attemptId:"attempt-2"}),false);});

