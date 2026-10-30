package com.calltrack.telecom

import android.telephony.PhoneNumberUtils

// Royal Cleaning Services defaults to Nepal. Match server canonical forms before
// consulting SIM country so a handset locale cannot change a saved lead identity.
object CallTrackPhone {
  fun normalize(raw: String): String {
    var value=raw.trim().replace(Regex("[\\s().-]"),"")
    if(value.startsWith("00")) value="+"+value.drop(2)
    if(value.matches(Regex("9[678][0-9]{8}"))) return "+977"+value
    if(value.matches(Regex("977[0-9]{8,10}"))) return "+"+value
    if(value.matches(Regex("0[1-9][0-9]{7,8}"))) return "+977"+value.drop(1)
    if(value.startsWith("+")) return PhoneNumberUtils.normalizeNumber(value)
    return PhoneNumberUtils.formatNumberToE164(value,"NP") ?: PhoneNumberUtils.normalizeNumber(value)
  }
}
