package com.calltrack.telecom

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object NativeCallCredentials {
  private const val ALIAS="calltrack_telecom_credentials_v1"
  private fun prefs(context: Context)=context.getSharedPreferences("calltrack_native_credentials",Context.MODE_PRIVATE)
  private fun key(): SecretKey {
    val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing=store.getKey(ALIAS,null) as? SecretKey
    if(existing!=null) return existing
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Synchronized fun put(context: Context,token: String,userId: String) {
    val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key()) }
    val plain=JSONObject().put("token",token).put("userId",userId).toString().toByteArray(Charsets.UTF_8)
    val value=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+"."+Base64.encodeToString(cipher.doFinal(plain),Base64.NO_WRAP)
    prefs(context).edit().putString("value",value).commit()
  }
  @Synchronized fun get(context: Context): JSONObject? {
    return try {
      val pieces=prefs(context).getString("value",null)?.split(".") ?: return null
      if(pieces.size!=2)return null
      val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply {init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(pieces[0],Base64.NO_WRAP)))}
      JSONObject(String(cipher.doFinal(Base64.decode(pieces[1],Base64.NO_WRAP)),Charsets.UTF_8))
    }catch(_:Exception){null}
  }
  @Synchronized fun clear(context: Context) { prefs(context).edit().remove("value").commit() }
}
object NativeCallSync {
  private val executor=Executors.newSingleThreadExecutor()
  private val busy=AtomicBoolean(false)
  fun enqueue(context: Context) {
    val app=context.applicationContext
    if(!busy.compareAndSet(false,true))return
    executor.execute { try { flush(app) } finally { busy.set(false) } }
  }
  private fun flush(context: Context) {
    val identity=TelecomStore.identity(context) ?: return
    val credentials=NativeCallCredentials.get(context) ?: return
    if(credentials.optString("userId")!=identity.optString("userId"))return
    val base=identity.optString("apiUrl").trimEnd('/')
    if(!base.startsWith("https://")&&!base.startsWith("http://"))return
    val pending=JSONArray(TelecomStore.pending(context))
    val events=JSONArray()
    for(index in 0 until pending.length()) {
      val item=pending.optJSONObject(index) ?: continue
      if(item.optBoolean("tracked",false)&&item.optString("userId")==identity.optString("userId")) {
        events.put(item);if(events.length()>=50)break
      }
    }
    if(events.length()==0)return
    var connection: HttpURLConnection?=null
    val status=context.getSharedPreferences("calltrack_telecom",Context.MODE_PRIVATE)
    try {
      connection=URL(base+"/device/calls").openConnection() as HttpURLConnection
      connection.requestMethod="POST";connection.connectTimeout=4000;connection.readTimeout=4000;connection.doOutput=true
      connection.setRequestProperty("Authorization","Bearer "+credentials.getString("token"))
      connection.setRequestProperty("Content-Type","application/json")
      connection.outputStream.use { it.write(JSONObject().put("events",events).toString().toByteArray(Charsets.UTF_8)) }
      if(connection.responseCode in 200..299) {
        val body=connection.inputStream.bufferedReader().use { it.readText() }
        val saved=JSONObject(body).optJSONArray("items") ?: JSONArray()
        for(index in 0 until saved.length()) {
          val item=saved.getJSONObject(index)
          TelecomStore.acknowledge(context,item.getString("deviceCallId"),item.getInt("sequence"))
        }
        status.edit().putLong("last_sync",System.currentTimeMillis()).remove("sync_error").apply()
      } else status.edit().putString("sync_error",if(connection.responseCode==401)"Sign in to sync phone events" else "Phone events are waiting to synchronize").apply()
    }catch(_:Exception) {
      status.edit().putString("sync_error","Phone events are saved on this device until a connection is available").apply()
    }finally { connection?.disconnect() }
  }
}
