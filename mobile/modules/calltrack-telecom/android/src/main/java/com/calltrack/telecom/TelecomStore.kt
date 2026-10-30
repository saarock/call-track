package com.calltrack.telecom

import android.content.Context
import android.content.res.Configuration
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object TelecomStore {
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null
  private fun prefs(context: Context) = context.getSharedPreferences("calltrack_telecom", Context.MODE_PRIVATE)
  @Synchronized fun deviceId(context: Context): String {
    val existing = prefs(context).getString("device_id", null)
    if (existing != null) return existing
    val id = UUID.randomUUID().toString()
    prefs(context).edit().putString("device_id", id).commit()
    return id
  }
  @Synchronized fun configure(context: Context, json: String) {
    val next = JSONObject(json)
    val old = JSONObject(prefs(context).getString("identity", "{}") ?: "{}")
    if(old.optString("userId") != next.optString("userId")) { NativeCallCredentials.clear(context);prefs(context).edit().remove("identity").remove("prepared").putString("contacts","[]").commit() }
    val token=next.optString("accessToken","")
    next.remove("accessToken")
    if(next.isNull("userId") || next.optString("userId").isBlank()) NativeCallCredentials.clear(context)
    else if(token.isNotBlank()) NativeCallCredentials.put(context,token,next.optString("userId"))
    val edit = prefs(context).edit().putString("identity", next.toString())
    if (old.optString("userId") != next.optString("userId")) edit.putString("contacts", "[]")
    edit.commit()
  }
  fun identity(context: Context): JSONObject? {
    val value = JSONObject(prefs(context).getString("identity", "{}") ?: "{}")
    if (value.isNull("userId") || value.optString("userId").isBlank() || value.optLong("validUntil",0) <= System.currentTimeMillis()) return null
    return value
  }
  fun isDark(context: Context): Boolean {
    val config = JSONObject(prefs(context).getString("identity", "{}") ?: "{}")
    return when (config.optString("themeMode","system")) {
      "dark" -> true
      "light" -> false
      else -> (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }
  }
  @Synchronized fun setContacts(context: Context, json: String) {
    val contacts = JSONArray(json)
    require(contacts.length() <= 5000) { "Too many cached contacts" }
    prefs(context).edit().putString("contacts", contacts.toString()).commit()
  }
  fun contact(context: Context, phone: String): JSONObject? {
    if (identity(context) == null) return null
    val contacts = JSONArray(prefs(context).getString("contacts", "[]") ?: "[]")
    for (index in 0 until contacts.length()) {
      val item = contacts.optJSONObject(index) ?: continue
      if (CallTrackPhone.normalize(item.optString("phone")) == CallTrackPhone.normalize(phone)) return item
    }
    return null
  }
  @Synchronized fun prepare(context: Context, json: String) {
    val owner=identity(context)?.optString("userId") ?: throw IllegalStateException("Sign in before preparing a business call")
    val data = JSONObject(json)
    require(data.optString("userId", owner)==owner) { "The signed-in agent changed before this call" }
    data.put("userId",owner).put("preparedAt", System.currentTimeMillis())
    prefs(context).edit().putString("prepared", data.toString()).commit()
  }
  @Synchronized fun clearPrepared(context: Context) { prefs(context).edit().remove("prepared").commit() }
  @Synchronized fun prepared(context: Context, phone: String): JSONObject? {
    val data = JSONObject(prefs(context).getString("prepared", "{}") ?: "{}")
    if (data.optString("userId") != identity(context)?.optString("userId") || System.currentTimeMillis() - data.optLong("preparedAt",0) > 120000 || CallTrackPhone.normalize(data.optString("phone")) != CallTrackPhone.normalize(phone)) return null
    prefs(context).edit().remove("prepared").commit()
    return data
  }
  fun historyItem(context: Context, callId: String): JSONObject? =
    JSONObject(prefs(context).getString("history", "{}") ?: "{}").optJSONObject(callId)
  @Synchronized fun publish(context: Context, snapshot: JSONObject) {
    val queue = JSONObject(prefs(context).getString("pending", "{}") ?: "{}")
    val history = JSONObject(prefs(context).getString("history", "{}") ?: "{}")
    val callId = snapshot.getString("callId")
    snapshot.put("deviceId", deviceId(context))
    snapshot.put("businessReported", history.optJSONObject(callId)?.optBoolean("businessReported",false) ?: false)
    history.put(callId, snapshot)
    queue.put(callId, snapshot)
    val keep = history.keys().asSequence().toList().sortedByDescending { history.optJSONObject(it)?.optString("startedAt") ?: "" }
    keep.drop(200).forEach { if(history.optJSONObject(it)?.optBoolean("businessReported",false)==true && !queue.has(it)) history.remove(it) }
    // Keep the newest snapshot of each call. Each snapshot carries its connection evidence.
    prefs(context).edit().putString("pending",queue.toString()).putString("history",history.toString()).commit()
    listener?.invoke(toMap(snapshot))
    NativeCallSync.enqueue(context)
  }
  @Synchronized fun acknowledge(context: Context, callId: String, sequence: Int) {
    val queue = JSONObject(prefs(context).getString("pending", "{}") ?: "{}")
    if ((queue.optJSONObject(callId)?.optInt("sequence",0) ?: 0) <= sequence) {
      queue.remove(callId); prefs(context).edit().putString("pending",queue.toString()).commit()
    }
  }
  @Synchronized fun markReported(context: Context, callId: String, skip: Boolean) {
    val history=JSONObject(prefs(context).getString("history","{}") ?: "{}")
    history.optJSONObject(callId)?.put("businessReported",true)
    val edit=prefs(context).edit().putString("history",history.toString())
    if(skip) {
      val queue=JSONObject(prefs(context).getString("pending","{}") ?: "{}")
      queue.remove(callId);edit.putString("pending",queue.toString())
    }
    edit.commit()
  }
  fun pending(context: Context): String = values(JSONObject(prefs(context).getString("pending","{}") ?: "{}")).toString()
  fun history(context: Context): String = values(JSONObject(prefs(context).getString("history","{}") ?: "{}")).toString()
  fun values(value: JSONObject): JSONArray {
    val result=JSONArray();value.keys().forEach { result.put(value.get(it)) };return result
  }
  fun toMap(value: JSONObject): Map<String, Any?> = value.keys().asSequence().associateWith { key ->
    val item=value.get(key)
    when(item) { JSONObject.NULL -> null; is JSONObject -> toMap(item); else -> item }
  }
}
