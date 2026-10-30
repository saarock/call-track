package com.calltrack.telecom
import expo.modules.kotlin.exception.toCodedException

import android.Manifest
import android.app.NotificationManager
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.CallLog
import android.provider.Settings
import android.telecom.TelecomManager
import android.telecom.PhoneAccount
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.Calendar
import java.util.Locale

class CallTrackTelecomModule : Module() {
  private fun context(): Context = appContext.reactContext ?: throw IllegalStateException("App context unavailable")
  private fun telecom() = context().getSystemService(Context.TELECOM_SERVICE) as TelecomManager
  private fun granted(permission: String) = context().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
  private fun defaultDialer() = telecom().defaultDialerPackage == context().packageName
  private var observer: ((Map<String, Any?>) -> Unit)? = null

  private var pendingDialerRoleRequest: expo.modules.kotlin.Promise? = null

  override fun definition() = ModuleDefinition {
    Name("CallTrackTelecom")
    Events("onPhoneChange","onDialNumber")
    OnCreate {
      observer={ value -> sendEvent("onPhoneChange",value) }
      TelecomStore.listener=observer
    }
    OnDestroy {
      if(TelecomStore.listener === observer) TelecomStore.listener=null
    }
    OnNewIntent { intent ->
      if(intent.action == Intent.ACTION_DIAL) {
        sendEvent("onDialNumber", mapOf("phone" to (intent.data?.schemeSpecificPart ?: "")))
      }
    }
    Function("newId") { java.util.UUID.randomUUID().toString() }
    Function("getVariant") {
      when(context().packageName) { "com.calltrack.dialer" -> "agent"; "com.calltrack.crm" -> "admin"; else -> "combined" }
    }
    AsyncFunction("configure") { json: String -> TelecomStore.configure(context(),json) }
    AsyncFunction("setContacts") { json: String -> TelecomStore.setContacts(context(),json) }
    AsyncFunction("getCapabilities") {
      val roleAvailable=if(Build.VERSION.SDK_INT>=29) (context().getSystemService(Context.ROLE_SERVICE) as RoleManager).isRoleAvailable(RoleManager.ROLE_DIALER) else context().packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
      val sync=context().getSharedPreferences("calltrack_telecom",Context.MODE_PRIVATE)
      val lastSync=sync.getLong("last_sync",0)
      JSONObject().put("available",true).put("defaultDialer",defaultDialer()).put("canRequestRole",roleAvailable)
        .put("callPermission",granted(Manifest.permission.CALL_PHONE)).put("phonePermission",granted(Manifest.permission.READ_PHONE_STATE))
        .put("callLogPermission",granted(Manifest.permission.READ_CALL_LOG))
        .put("notifications",Build.VERSION.SDK_INT<33 || granted(Manifest.permission.POST_NOTIFICATIONS))
        .put("fullScreenNotifications",Build.VERSION.SDK_INT<34 || (context().getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent())
        .put("recording",false).put("nativeSyncError",sync.getString("sync_error","")).put("lastNativeSync",if(lastSync>0)Instant.ofEpochMilli(lastSync).toString() else JSONObject.NULL).put("activeCallCount",CallTrackInCallService.activeCount).put("deviceId",TelecomStore.deviceId(context())).toString()
    }
    AsyncFunction("requestDialerRole") { promise: expo.modules.kotlin.Promise ->
      if (defaultDialer()) {
        promise.resolve(true)
      } else {
        check(pendingDialerRoleRequest == null) {
          "Phone setup is already in progress"
        }

        val activity = appContext.currentActivity
          ?: throw IllegalStateException("Open the app first")

        val intent = if (Build.VERSION.SDK_INT >= 29) {
          val roles = context().getSystemService(Context.ROLE_SERVICE) as RoleManager
          require(roles.isRoleAvailable(RoleManager.ROLE_DIALER)) {
            "Default Phone role unavailable"
          }
          roles.createRequestRoleIntent(RoleManager.ROLE_DIALER)
        } else {
          Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
            .putExtra(
              TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME,
              context().packageName
            )
        }

        pendingDialerRoleRequest = promise

        activity.runOnUiThread {
          try {
            activity.startActivityForResult(intent, 40142)
          } catch (error: Exception) {
            pendingDialerRoleRequest = null
            promise.reject(error.toCodedException())
          }
        }
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == 40142) {
        val pending = pendingDialerRoleRequest
        pendingDialerRoleRequest = null
        pending?.resolve(defaultDialer())
      }
    }
    AsyncFunction("openSettings") {
      context().startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+context().packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("getSimAccounts") {
      val result=JSONArray()
      if(defaultDialer() && granted(Manifest.permission.READ_PHONE_STATE)) {
        telecom().callCapablePhoneAccounts.forEach { handle ->
          val account=telecom().getPhoneAccount(handle)
          if(account?.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION)==true) result.put(JSONObject().put("id",handle.id).put("label",account.label?.toString() ?: "SIM account"))
        }
      }
      result.toString()
    }
    AsyncFunction("isEmergencyNumber") { phone: String ->
      val clean=PhoneNumberUtils.normalizeNumber(phone)
      try {
        if(Build.VERSION.SDK_INT>=29) (context().getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager).isEmergencyNumber(clean)
        else PhoneNumberUtils.isEmergencyNumber(clean)
      } catch(_:Exception) { PhoneNumberUtils.isEmergencyNumber(clean) }
    }
    AsyncFunction("placeCall") { phone: String, accountId: String?, metadata: String ->
      require(defaultDialer()) { "Choose CallTrack Dialer as your default phone app first" }
      require(granted(Manifest.permission.CALL_PHONE)) { "Allow phone calls in app permissions first" }
      val clean=PhoneNumberUtils.normalizeNumber(phone)
      require(clean.matches(Regex("[+0-9*#]{1,40}"))) { "Enter a valid phone number" }
      val contextData=JSONObject(metadata).put("phone",normalizePhone(clean))
      if(contextData.has("userId")) require(contextData.optString("userId")==TelecomStore.identity(context())?.optString("userId")) { "The signed-in agent changed before dialing" }
      val emergency = if(Build.VERSION.SDK_INT>=29) (context().getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager).isEmergencyNumber(clean) else PhoneNumberUtils.isEmergencyNumber(clean)
      if(!emergency && TelecomStore.identity(context())!=null) TelecomStore.prepare(context(),contextData.toString())
      val extras=Bundle()
      if(!emergency) {
        require(granted(Manifest.permission.READ_PHONE_STATE)) { "Allow phone-state access to select an available SIM" }
        val sims=telecom().callCapablePhoneAccounts.filter { telecom().getPhoneAccount(it)?.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION)==true }
        require(sims.isNotEmpty()) { "No active SIM or eSIM call account is available" }
        val handle=if(accountId!=null)sims.firstOrNull { it.id==accountId } else sims.singleOrNull()
        require(handle!=null) { "Select an available SIM for this call" }
        extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,handle)
      }
      try { telecom().placeCall(Uri.fromParts("tel",clean,null),extras) }
      catch(error:Exception) { TelecomStore.clearPrepared(context());throw error }
      true
    }
    AsyncFunction("getPending") { TelecomStore.pending(context()) }
    AsyncFunction("getHistory") { TelecomStore.history(context()) }
    AsyncFunction("acknowledge") { callId: String, sequence: Int -> TelecomStore.acknowledge(context(),callId,sequence) }
    AsyncFunction("markReported") { callId: String, skip: Boolean -> TelecomStore.markReported(context(),callId,skip) }
    AsyncFunction("showActiveCall") {
      context().startActivity(Intent(context(),CallTrackCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("takeOpenLead") {
      val prefs=context().getSharedPreferences("calltrack_telecom",Context.MODE_PRIVATE)
      val id=prefs.getString("open_lead","") ?: ""
      prefs.edit().remove("open_lead").commit();id
    }
    AsyncFunction("getDialNumber") {
      val intent=appContext.currentActivity?.intent
      if(intent?.action==Intent.ACTION_DIAL) {
        val phone=intent.data?.schemeSpecificPart ?: ""
        intent.action=Intent.ACTION_MAIN;intent.data=null;phone
      } else null
    }
    AsyncFunction("getCallLog") {
      val result=JSONArray()
      require(defaultDialer() && granted(Manifest.permission.READ_CALL_LOG)) { "Call history requires the default phone role and call-log permission" }
      val columns=arrayOf(CallLog.Calls._ID,CallLog.Calls.NUMBER,CallLog.Calls.DATE,CallLog.Calls.DURATION,CallLog.Calls.TYPE,CallLog.Calls.CACHED_NAME)
      context().contentResolver.query(CallLog.Calls.CONTENT_URI,columns,null,null,CallLog.Calls.DATE+" DESC")?.use { cursor ->
        while(cursor.moveToNext() && result.length()<100) {
          result.put(JSONObject().put("id",cursor.getString(0)).put("phone",cursor.getString(1) ?: "Private number")
            .put("startedAt",Instant.ofEpochMilli(cursor.getLong(2)).toString()).put("durationSeconds",cursor.getLong(3))
            .put("type",cursor.getInt(4)).put("name",cursor.getString(5) ?: ""))
        }
      }
      result.toString()
    }
    AsyncFunction("pickDateTime") { initial: Double, promise: Promise ->
      val activity=appContext.currentActivity ?: throw IllegalStateException("Open the app first")
      activity.runOnUiThread {
        val date=Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kathmandu")).apply { timeInMillis=initial.toLong() }
        val picker=DatePickerDialog(activity,{ _,year,month,day ->
          date.set(Calendar.YEAR,year);date.set(Calendar.MONTH,month);date.set(Calendar.DAY_OF_MONTH,day)
          val time=TimePickerDialog(activity,{ _,hour,minute ->
            date.set(Calendar.HOUR_OF_DAY,hour);date.set(Calendar.MINUTE,minute);date.set(Calendar.SECOND,0);date.set(Calendar.MILLISECOND,0)
            promise.resolve(Instant.ofEpochMilli(date.timeInMillis).toString())
          },date.get(Calendar.HOUR_OF_DAY),date.get(Calendar.MINUTE),true)
          time.setOnCancelListener { promise.resolve(null) };time.show()
        },date.get(Calendar.YEAR),date.get(Calendar.MONTH),date.get(Calendar.DAY_OF_MONTH))
        picker.setOnCancelListener { promise.resolve(null) };picker.show()
      }
    }
  }
  fun normalizePhone(phone: String): String = CallTrackPhone.normalize(phone)
}
