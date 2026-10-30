package com.calltrack.telecom

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.TelecomManager
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.Locale

class CallTrackCallActivity: Activity() {
  private val handler=Handler(Looper.getMainLooper())
  private lateinit var root: LinearLayout
  private var timer: TextView?=null
  private var selectedId: String?=null
  private var signature=""
  private var keypad=false
  private var returned=false
  private val regular by lazy { try { Typeface.createFromAsset(assets,"Inter_400Regular.ttf") } catch(_:Exception){Typeface.DEFAULT} }
  private val bold by lazy { try { Typeface.createFromAsset(assets,"Inter_700Bold.ttf") } catch(_:Exception){Typeface.DEFAULT_BOLD} }
  private val update=object: Runnable { override fun run(){refresh();handler.postDelayed(this,1000)} }
  private fun dp(value: Int)=(value*resources.displayMetrics.density).toInt()
  private fun color(value: String)=Color.parseColor(value)
  private fun dark()=TelecomStore.isDark(this)
  private fun background()=color(if(dark())"#101725" else "#F6F7FB")
  private fun surface()=color(if(dark())"#1A2435" else "#FFFFFF")
  private fun ink()=color(if(dark())"#EDF2FC" else "#17223B")
  private fun muted()=color(if(dark())"#A1AEC4" else "#7B8497")
  private fun shape(fill: Int,radius: Int=16)=GradientDrawable().apply{setColor(fill);cornerRadius=dp(radius).toFloat()}
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true)} else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility=0
    root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setBackgroundColor(color("#151C30")) }
    root.setOnApplyWindowInsetsListener { view,insets ->
      val top=if(Build.VERSION.SDK_INT>=30)insets.getInsets(WindowInsets.Type.systemBars()).top else insets.systemWindowInsetTop
      val bottom=if(Build.VERSION.SDK_INT>=30)insets.getInsets(WindowInsets.Type.systemBars()).bottom else insets.systemWindowInsetBottom
      view.setPadding(0,top,0,bottom);insets
    }
    setContentView(root)
  }
  override fun onResume(){super.onResume();handler.post(update)}
  override fun onPause(){handler.removeCallbacks(update);super.onPause()}
  private fun text(value: String,size: Float,foreground: Int,strong: Boolean=false): TextView =
    TextView(this).apply { this.text=value;textSize=size;setTextColor(foreground);typeface=if(strong)bold else regular;gravity=Gravity.CENTER }
  private fun addText(parent: LinearLayout,value: String,size: Float,foreground: Int,strong: Boolean=false,margin: Int=10): TextView {
    val view=text(value,size,foreground,strong)
    parent.addView(view,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(margin) });return view
  }
  private fun actionButton(label: String,fill: Int,foreground: Int,onClick:()->Unit): Button = Button(this).apply {
    text=label;textSize=14f;typeface=bold;isAllCaps=false;setTextColor(foreground);background=shape(fill,18)
    setPadding(dp(8),dp(10),dp(8),dp(10));setOnClickListener{try{onClick()}catch(error:Exception){Toast.makeText(this@CallTrackCallActivity,error.message?:"Action unavailable",Toast.LENGTH_LONG).show()}}
    contentDescription=label
  }
  private fun record(): ObservedCall? {
    val calls=CallTrackInCallService.records.values.toList()
    return calls.firstOrNull{it.call.state==Call.STATE_RINGING}
      ?: calls.firstOrNull{it.id==selectedId}
      ?: calls.firstOrNull{it.call.state==Call.STATE_ACTIVE}
      ?: calls.firstOrNull()
  }
  private fun launchCRM(leadId: String?=null) {
    if(leadId!=null) getSharedPreferences("calltrack_telecom",Context.MODE_PRIVATE).edit().putString("open_lead",leadId).commit()
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }
  }
  private fun refresh() {
    val record=record()
    if(record==null) {
      if(!returned) { returned=true;if(TelecomStore.identity(this)!=null)launchCRM();finish() }
      return
    }
    selectedId=record.id
    val audio=CallTrackInCallService.current?.callAudioState
    val next=record.id+":"+record.stateName()+":"+(audio?.isMuted?:false)+":"+(audio?.route?:0)+":"+CallTrackInCallService.records.size+":"+keypad+":"+dark()
    if(next!=signature){signature=next;draw(record)}
    timer?.text=if(record.answered())String.format(Locale.ROOT,"%02d:%02d",record.seconds()/60,record.seconds()%60) else ""
  }
  private fun draw(record: ObservedCall) {
    root.removeAllViews()
    val scroll=ScrollView(this).apply{setBackgroundColor(background());isFillViewport=true}
    root.addView(scroll,LinearLayout.LayoutParams(-1,-1))
    val page=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL}
    scroll.addView(page)
    val hero=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(25),dp(24),dp(30));setBackgroundColor(color("#151C30"))}
    page.addView(hero)
    addText(hero,"CALLTRACK DIALER",11f,color("#A5A0E6"),true,0)
    val state=when(record.stateName()){
      "RINGING" -> "Incoming call"
      "ACTIVE" -> "Connected"
      "HOLDING" -> "On hold"
      "SELECT_PHONE_ACCOUNT" -> "Choose a SIM"
      "DISCONNECTING" -> "Ending call"
      "DISCONNECTED" -> "Call ended"
      else -> "Dialing"
    }
    addText(hero,state,14f,color("#BFC8DB"),false,15)
    val initial=record.name.trim().split(" ").filter{it.isNotBlank()}.take(2).map{it.first()}.joinToString("").ifBlank{"CT"}.uppercase(Locale.ROOT)
    val avatar=text(initial,29f,color("#DAD6FF"),true).apply{background=shape(color("#343052"),38);gravity=Gravity.CENTER}
    hero.addView(avatar,LinearLayout.LayoutParams(dp(84),dp(84)).apply{gravity=Gravity.CENTER;topMargin=dp(26)})
    addText(hero,record.name.ifBlank{"Phone call"},25f,Color.WHITE,true,20)
    addText(hero,record.phone,17f,color("#BDC7DD"),false,8)
    timer=addText(hero,"",27f,Color.WHITE,true,17)
    if(CallTrackInCallService.records.size>1) addText(hero,CallTrackInCallService.records.size.toString()+" calls on this device",12f,color("#A5AFC5"),false,10)
    val controls=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(22),dp(24),dp(28));setBackgroundColor(background())}
    page.addView(controls,LinearLayout.LayoutParams(-1,-2))
    val service=CallTrackInCallService.current
    if(record.call.state==Call.STATE_SELECT_PHONE_ACCOUNT) {
      addText(controls,"Select the SIM for this call",15f,ink(),true,0)
      val accounts=try {
        if(checkSelfPermission(Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED)
          (getSystemService(Context.TELECOM_SERVICE) as TelecomManager).callCapablePhoneAccounts else emptyList()
      }catch(_:Exception){emptyList()}
      for(account in accounts) {
        val label=(getSystemService(Context.TELECOM_SERVICE) as TelecomManager).getPhoneAccount(account)?.label?.toString()?:"Phone account"
        controls.addView(actionButton(label,surface(),ink()){record.call.phoneAccountSelected(account,false)},LinearLayout.LayoutParams(-1,dp(58)).apply{topMargin=dp(10)})
      }
      if(accounts.isEmpty()) addText(controls,"Phone-account permission is needed to show your available SIMs.",13f,muted(),false,12)
    }
    if(record.call.state==Call.STATE_RINGING) {
      val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER}
      row.addView(actionButton("Decline",color("#D84B64"),Color.WHITE){service?.perform(record.id,"decline")},LinearLayout.LayoutParams(0,dp(62),1f).apply{rightMargin=dp(8)})
      row.addView(actionButton("Answer",color("#169B80"),Color.WHITE){service?.perform(record.id,"answer")},LinearLayout.LayoutParams(0,dp(62),1f).apply{leftMargin=dp(8)})
      controls.addView(row)
    } else {
      val grid=GridLayout(this).apply{columnCount=3;rowCount=2}
      val muted=service?.callAudioState?.isMuted?:false
      val speaker=service?.callAudioState?.route==CallAudioState.ROUTE_SPEAKER
      val held=record.call.state==Call.STATE_HOLDING
      val entries=listOf(
        Triple(if(muted)"Unmute" else "Mute",muted,{service?.perform(record.id,"mute");Unit}),
        Triple(if(speaker)"Earpiece" else "Speaker",speaker,{service?.perform(record.id,"speaker");Unit}),
        Triple(if(held)"Resume" else "Hold",held,{service?.perform(record.id,"hold");Unit}),
        Triple("Keypad",keypad,{keypad=!keypad;signature="";refresh();Unit}),
      )
      for((index,entry) in entries.withIndex()) {
        val button=actionButton(entry.first,if(entry.second)color(if(dark())"#38315C" else "#EEEDFF") else surface(),if(entry.second)color(if(dark())"#BBAFFF" else "#4F46E5") else ink(),entry.third)
        if(index==2) button.isEnabled=held || (record.call.details.callCapabilities and Call.Details.CAPABILITY_HOLD)!=0
        if(index==3) button.isEnabled=record.call.state==Call.STATE_ACTIVE
        if(!button.isEnabled)button.alpha=0.45f
        grid.addView(button,GridLayout.LayoutParams().apply{width=0;height=dp(62);columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);setMargins(dp(4),dp(4),dp(4),dp(8))})
      }
      controls.addView(grid,LinearLayout.LayoutParams(-1,-2))
      if(keypad) {
        val digits=GridLayout(this).apply{columnCount=3;rowCount=4}
        "123456789*0#".forEach { digit ->
          val button=actionButton(digit.toString(),surface(),ink()){
            record.call.playDtmfTone(digit);handler.postDelayed({record.call.stopDtmfTone()},160)
          }
          digits.addView(button,GridLayout.LayoutParams().apply{width=0;height=dp(58);columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);setMargins(dp(4),dp(4),dp(4),dp(4))})
        }
        controls.addView(digits,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(10)})
      }
      if(CallTrackInCallService.records.size>1) {
        controls.addView(actionButton("View other call",surface(),ink()){
          val other=CallTrackInCallService.records.values.firstOrNull{it.id!=record.id}
          if(other!=null){selectedId=other.id;signature="";refresh()}
        },LinearLayout.LayoutParams(-1,dp(50)).apply{topMargin=dp(12)})
      }
      controls.addView(actionButton("End call",color("#D84B64"),Color.WHITE){service?.perform(record.id,"end")},LinearLayout.LayoutParams(-1,dp(62)).apply{topMargin=dp(22)})
    }
    if(record.leadId!=null) controls.addView(actionButton("Customer & previous conversations",surface(),ink()){launchCRM(record.leadId)},LinearLayout.LayoutParams(-1,dp(52)).apply{topMargin=dp(15)})
    addText(controls,"Call audio is handled by Android Telecom.",11f,muted(),false,20)
  }
}
