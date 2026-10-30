package com.calltrack.telecom

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.DisconnectCause
import android.telecom.InCallService
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import org.json.JSONObject
import java.time.Instant
import java.util.Locale
import java.util.UUID

class ObservedCall(val service: CallTrackInCallService, val call: Call) {
  private val context: Context = service
  private val created = call.details.creationTimeMillis
  private val firstObserved = System.currentTimeMillis()
  private val history = if(created>0) TelecomStore.values(JSONObject(context.getSharedPreferences("calltrack_telecom",Context.MODE_PRIVATE).getString("history","{}") ?: "{}")) else null
  private val previous: JSONObject? = history?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) }.firstOrNull { it.optLong("nativeCreationMs")==created } }
  val id: String = previous?.optString("callId")?.takeIf { it.isNotBlank() }
    ?: if(created>0) UUID.nameUUIDFromBytes((TelecomStore.deviceId(context)+":"+created+":"+(call.details.handle?.schemeSpecificPart ?: "private")).toByteArray()).toString() else UUID.randomUUID().toString()
  private val emergency = try {
    val number = call.details.handle?.schemeSpecificPart ?: ""
    if(Build.VERSION.SDK_INT>=29)(context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager).isEmergencyNumber(number) else PhoneNumberUtils.isEmergencyNumber(number)
  } catch(_:Exception) { false }
  private val identity = if(emergency) null else previous?.takeIf { !it.optString("userId").isBlank() } ?: TelecomStore.identity(context)
  private var sequence = previous?.optInt("sequence",0) ?: 0
  private var connectedAt = previous?.optString("connectedAt")?.takeIf { it.isNotBlank() && it!="null" }?.let { Instant.parse(it).toEpochMilli() } ?: 0L
  private var connectedElapsed = previous?.optLong("nativeConnectedElapsed",0) ?: 0L
  private var hasConnectTime = previous?.optBoolean("nativeHasConnectTime",false) ?: false
  private var endedAt = previous?.optString("endedAt")?.takeIf { it.isNotBlank() && it!="null" }?.let { Instant.parse(it).toEpochMilli() } ?: 0L
  private var endedElapsed = previous?.optLong("nativeEndedElapsed",0) ?: 0L
  var phone = previous?.optString("phone") ?: "Private number"
  var name = previous?.optString("customerName") ?: ""
  var leadId = previous?.optString("leadId")?.takeIf { it!="null" && it.isNotBlank() }
  var tracked = previous?.optBoolean("tracked",false) ?: false
  private var attemptId = previous?.optString("attemptId")?.takeIf { it.isNotBlank() && it!="null" }
  private var reservationId = previous?.optString("reservationId")?.takeIf { it.isNotBlank() && it!="null" }
  private var sessionId = previous?.optString("sessionId")?.takeIf { it.isNotBlank() && it!="null" }
  var direction = when {
    Build.VERSION.SDK_INT>=29 && call.details.callDirection==Call.Details.DIRECTION_INCOMING -> "incoming"
    Build.VERSION.SDK_INT>=29 && call.details.callDirection==Call.Details.DIRECTION_OUTGOING -> "outgoing"
    call.state==Call.STATE_RINGING -> "incoming"
    call.state==Call.STATE_DIALING || call.state==Call.STATE_CONNECTING || call.state==Call.STATE_SELECT_PHONE_ACCOUNT -> "outgoing"
    else -> previous?.optString("direction","unknown") ?: "unknown"
  }
  val callback = object: Call.Callback() {
    override fun onStateChanged(call: Call, state: Int) { publish(); service.refresh(this@ObservedCall) }
    override fun onDetailsChanged(call: Call, details: Call.Details) { publish(); service.refresh(this@ObservedCall) }
  }
  init { publish() }
  fun stateName(): String = when(call.state) {
    Call.STATE_NEW -> "NEW"
    Call.STATE_SELECT_PHONE_ACCOUNT -> "SELECT_PHONE_ACCOUNT"
    Call.STATE_CONNECTING -> "CONNECTING"
    Call.STATE_DIALING -> "DIALING"
    Call.STATE_RINGING -> "RINGING"
    Call.STATE_ACTIVE -> "ACTIVE"
    Call.STATE_HOLDING -> "HOLDING"
    Call.STATE_DISCONNECTING -> "DISCONNECTING"
    Call.STATE_DISCONNECTED -> "DISCONNECTED"
    else -> "NEW"
  }
  private fun normalized(raw: String): String = CallTrackPhone.normalize(raw)
  private fun updateContact() {
    if(call.details.handlePresentation==TelecomManager.PRESENTATION_ALLOWED) {
      val raw=call.details.handle?.schemeSpecificPart
      if(!raw.isNullOrBlank()) {
        phone=normalized(raw).ifBlank { raw }
        val sameOwner = identity?.optString("userId") == TelecomStore.identity(context)?.optString("userId")
        val prepared=if(sameOwner && direction=="outgoing") TelecomStore.prepared(context,phone) else null
        if(prepared!=null) {
          attemptId=prepared.optString("attemptId").takeIf { it.isNotBlank() && it!="null" }
          reservationId=prepared.optString("reservationId").takeIf { it.isNotBlank() && it!="null" }
          sessionId=prepared.optString("sessionId").takeIf { it.isNotBlank() && it!="null" }
        }
        val contact=prepared ?: if(sameOwner) TelecomStore.contact(context,phone) else null
        if(contact!=null && identity!=null) {
          name=contact.optString("customerName",contact.optString("fullName",name))
          leadId=contact.optString("leadId","").takeIf { it.isNotBlank() && it!="null" }
          tracked=true
        }
      }
    }
  }
  fun publish() {
    direction=when {
      Build.VERSION.SDK_INT>=29 && call.details.callDirection==Call.Details.DIRECTION_INCOMING -> "incoming"
      Build.VERSION.SDK_INT>=29 && call.details.callDirection==Call.Details.DIRECTION_OUTGOING -> "outgoing"
      call.state==Call.STATE_RINGING -> "incoming"
      call.state==Call.STATE_DIALING || call.state==Call.STATE_CONNECTING || call.state==Call.STATE_SELECT_PHONE_ACCOUNT -> "outgoing"
      else -> direction
    }
    updateContact()
    val details=call.details
    val now=System.currentTimeMillis()
    if(details.connectTimeMillis>0) {
      if(connectedAt<=0 || !hasConnectTime) {
        connectedAt=details.connectTimeMillis
        connectedElapsed=SystemClock.elapsedRealtime()-(now-connectedAt).coerceAtLeast(0)
      }
      hasConnectTime=true
    } else if(connectedAt<=0 && (call.state==Call.STATE_ACTIVE || call.state==Call.STATE_HOLDING)) {
      connectedAt=now;connectedElapsed=SystemClock.elapsedRealtime()
    }
    if(call.state==Call.STATE_DISCONNECTED && endedAt==0L) { endedAt=now;endedElapsed=SystemClock.elapsedRealtime() }
    if(identity==null || identity.optString("userId").isBlank() || !tracked) return
    sequence+=1
    val snapshot=JSONObject()
      .put("callId",id).put("sequence",sequence).put("userId",identity.optString("userId"))
      .put("state",stateName()).put("phone",phone)
      .put("normalizedPhone",if(phone.matches(Regex("\\+[1-9][0-9]{7,14}"))) phone else JSONObject.NULL)
      .put("direction",direction).put("startedAt",Instant.ofEpochMilli(if(created>0)created else previous?.optString("startedAt")?.let { Instant.parse(it).toEpochMilli() } ?: firstObserved).toString())
      .put("observedAt",Instant.ofEpochMilli(now).toString())
      .put("connectedAt",if(connectedAt>0)Instant.ofEpochMilli(connectedAt).toString() else JSONObject.NULL)
      .put("endedAt",if(endedAt>0)Instant.ofEpochMilli(endedAt).toString() else JSONObject.NULL)
      .put("hadActive",connectedAt>0)
      .put("durationSeconds",if(endedAt>0 && hasConnectTime && connectedElapsed>0) ((endedElapsed-connectedElapsed)/1000).coerceAtLeast(0) else JSONObject.NULL)
      .put("disconnectCause",causeName(details.disconnectCause?.code))
      .put("leadId",leadId ?: JSONObject.NULL).put("customerName",name)
      .put("tracked",tracked).put("startTimeKnown",created>0)
      .put("attemptId",attemptId ?: JSONObject.NULL).put("reservationId",reservationId ?: JSONObject.NULL).put("sessionId",sessionId ?: JSONObject.NULL)
      .put("nativeCreationMs",created).put("nativeConnectedElapsed",connectedElapsed).put("nativeHasConnectTime",hasConnectTime).put("nativeEndedElapsed",endedElapsed)
    TelecomStore.publish(context,snapshot)
  }
  fun seconds(): Long = if(connectedElapsed>0) (((if(endedElapsed>0)endedElapsed else SystemClock.elapsedRealtime())-connectedElapsed)/1000).coerceAtLeast(0) else 0L
  fun answered(): Boolean = connectedAt>0
  private fun causeName(code: Int?): String = when(code) {
    DisconnectCause.LOCAL -> "LOCAL"
    DisconnectCause.REMOTE -> "REMOTE"
    DisconnectCause.BUSY -> "BUSY"
    DisconnectCause.MISSED -> "MISSED"
    DisconnectCause.REJECTED -> "REJECTED"
    DisconnectCause.CANCELED -> "CANCELED"
    DisconnectCause.ERROR -> "ERROR"
    DisconnectCause.RESTRICTED -> "RESTRICTED"
    else -> "UNKNOWN"
  }
}

class CallTrackInCallService: InCallService() {
  companion object {
    @Volatile var current: CallTrackInCallService? = null
    @Volatile var activeCount: Int = 0
    val records=linkedMapOf<String,ObservedCall>()
  }
  private val handler=Handler(Looper.getMainLooper())
  private val heartbeat=object: Runnable {
    override fun run() {
      records.values.toList().forEach { it.publish() }
      if(records.isNotEmpty()) handler.postDelayed(this,15000)
    }
  }
  override fun onCreate() { super.onCreate();current=this;createChannels() }
  override fun onCallAdded(call: Call) {
    super.onCallAdded(call)
    val record=ObservedCall(this,call);records[record.id]=record;call.registerCallback(record.callback)
    refresh(record)
    handler.removeCallbacks(heartbeat);handler.postDelayed(heartbeat,15000)
    try { startActivity(Intent(this,CallTrackCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) } catch(_:Exception) {}
  }
  override fun onCallRemoved(call: Call) {
    val record=records.values.firstOrNull { it.call===call }
    if(record!=null) { record.publish();call.unregisterCallback(record.callback);records.remove(record.id);notifications().cancel(record.id.hashCode()) }
    activeCount=records.values.count { it.call.state!=Call.STATE_DISCONNECTED }
    if(records.isEmpty()) handler.removeCallbacks(heartbeat)
    super.onCallRemoved(call)
  }
  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    records.values.toList().forEach { it.call.unregisterCallback(it.callback) }
    records.clear();activeCount=0;current=null;super.onDestroy()
  }
  private fun notifications()=getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private fun createChannels() {
    val incoming=NotificationChannel("calltrack_incoming","Incoming phone calls",NotificationManager.IMPORTANCE_HIGH)
    incoming.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
    incoming.lockscreenVisibility=Notification.VISIBILITY_PRIVATE
    notifications().createNotificationChannel(incoming)
    notifications().createNotificationChannel(NotificationChannel("calltrack_ongoing","Ongoing phone calls",NotificationManager.IMPORTANCE_LOW))
  }
  fun refresh(record: ObservedCall) {
    activeCount=records.values.count { it.call.state!=Call.STATE_DISCONNECTED };
    if(record.call.state==Call.STATE_DISCONNECTED) { notifications().cancel(record.id.hashCode());return }
    if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return
    val ringing=record.call.state==Call.STATE_RINGING
    val intent=Intent(this,CallTrackCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val content=PendingIntent.getActivity(this,record.id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder=Notification.Builder(this,if(ringing)"calltrack_incoming" else "calltrack_ongoing")
      .setSmallIcon(android.R.drawable.sym_action_call).setContentTitle(record.name.ifBlank { record.phone })
      .setContentText(if(ringing)"Incoming phone call" else if(record.answered())"Phone call connected" else "Phone call in progress")
      .setCategory(Notification.CATEGORY_CALL).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE)
      .setContentIntent(content).setOnlyAlertOnce(!ringing)
    if(ringing) {
      builder.setFullScreenIntent(content,true)
      builder.addAction(android.R.drawable.sym_action_call,"Answer",action(record.id,"answer"))
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel,"Decline",action(record.id,"decline"))
    } else builder.addAction(android.R.drawable.ic_menu_close_clear_cancel,"End call",action(record.id,"end"))
    val notification=builder.build()
    if(ringing) notification.flags=notification.flags or Notification.FLAG_INSISTENT
    notifications().notify(record.id.hashCode(),notification)
  }
  private fun action(callId: String,action: String): PendingIntent {
    val intent=Intent(this,CallTrackCallActionReceiver::class.java).putExtra("callId",callId).putExtra("action",action)
    return PendingIntent.getBroadcast(this,(callId+action).hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
  fun perform(callId: String,action: String) {
    val record=records[callId] ?: return
    when(action) {
      "answer" -> record.call.answer(VideoProfile.STATE_AUDIO_ONLY)
      "decline" -> record.call.reject(false,null)
      "end" -> record.call.disconnect()
      "hold" -> if(record.call.state==Call.STATE_HOLDING) record.call.unhold() else record.call.hold()
      "mute" -> setMuted(!(callAudioState?.isMuted ?: false))
      "speaker" -> toggleSpeaker()
    }
  }
  @Suppress("DEPRECATION")
  private fun toggleSpeaker() { setAudioRoute(if(callAudioState?.route==CallAudioState.ROUTE_SPEAKER)CallAudioState.ROUTE_WIRED_OR_EARPIECE else CallAudioState.ROUTE_SPEAKER) }
}
class CallTrackCallActionReceiver: BroadcastReceiver() {
  override fun onReceive(context: Context,intent: Intent) {
    val callId=intent.getStringExtra("callId") ?: return
    val action=intent.getStringExtra("action") ?: return
    CallTrackInCallService.current?.perform(callId,action)
  }
}
