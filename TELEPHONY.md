# Supported telephony and optional PBX

## Current SIM path

CallTrack Dialer is an Android default-phone UI using TelecomManager.placeCall and InCallService callbacks. It does not carry call audio through the Node server. Therefore the server cannot record or listen to that audio. The app reports actual available Android events and labels agent-entered business outcomes separately.

Default-phone permission does not grant Android's system-reserved CAPTURE_AUDIO_OUTPUT permission. Two-sided VOICE_CALL recording is not available to an ordinary installed APK through that public audio source. No microphone/accessibility/root workaround is presented as a reliable call recorder. OEM recording features vary by device, firmware, region, carrier and enterprise agreement, and require a supported vendor API plus device-specific testing before integration. Private installation does not remove these platform restrictions. [Android audio sources](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource#VOICE_CALL), [default phone requirements](https://developer.android.com/develop/connectivity/telecom/dialer-app).

## Optional company-controlled PBX path

## Existing audio attachments

CallTrack now supports authorized existing audio files without an automatic SIM recording integration. Agents explicitly select an audio file and confirm permission; a private copy survives offline retry. The server validates audio, encrypts it with AES-256-GCM outside the web directory, applies call/team permissions and retention, and audits playback/download. Recordings are labeled as agent-uploaded and independently unverified. File duration never becomes telephone talk duration. See `server/routes/recordingRoutes.js`, `mobile/context/RecordingContext.js` and `mobile/screens/RecordingScreens.js`.

Automatic SIM capture and live supervisor listening remain subject to the platform/provider restrictions above.

Reliable recording, authorized supervisor listening and browser calling need calls whose audio is actually carried by an approved telephony platform. A supported architecture is:

Company SIP trunk/carrier -> Asterisk/PBX -> agent SIP/WebRTC endpoints
                                     -> authenticated event/recording adapter -> CallTrack backend
                                     -> private encrypted recording storage

This is a separate optional calling method. It does not interrupt existing independent SIM use. Twilio is not required. Asterisk can be evaluated as a self-hosted component; its software license does not include a carrier trunk, telephone numbers, hosting or call charges.

Required company decisions and infrastructure:
1. Authorized Nepal-compatible SIP trunk or carrier/PBX service with allowed caller ID, inbound numbers, concurrency for around 10 agents, emergency-call routing policy and an agreed tariff.
2. Company server/network and PBX administrator; TLS/SRTP/WSS, TURN if required by WebRTC/NAT, firewall/abuse controls, caller identity policy and documented disaster recovery.
3. SIP/WebRTC endpoints or supported desk/mobile clients. The current SIM keypad is not a browser softphone.
4. Recording notice/consent and employee-monitoring policy approved for the actual jurisdictions/customers and business purpose. Default to no recording until approved.
5. Private encrypted storage, retention period, deletion job, authorized playback/download roles and access audit. Never expose recording files under a public static path.
6. Provider/PBX event credentials and an adapter that verifies signature/transport/tenant and deduplicates stable provider call IDs.
7. A company test account/trunk/number to verify both audio channels, call metadata, permissions, retention and monitoring access end to end.

Suggested integration contract for a future adapter:
- map stable provider call ID to company, agent, campaign and customer/normalized number;
- accept provider-created ringing/answer/end timestamps, direction and duration with explicit source evidence;
- store agent outcomes independently of provider lifecycle;
- only attach real recording objects after authenticated upload, media validation, checksum and successful object-store write;
- retain explicit pending/failed/uploaded recording states; no available flag until a real object exists;
- authorize each playback/download against current team/customer permissions and audit access;
- route supervisor monitor requests through PBX authorization and auditable call controls;
- use a provider/adapter-owned credential on the server; never put trunk secrets into EXPO_PUBLIC_* or a downloadable web bundle.

The repository's current SIM implementation does not provide Asterisk trunk provisioning, SIP/WebRTC media, two-sided recording ingestion or live listening. These require a concrete approved provider/server/audio source and validation. Existing demo audio, if any legacy demo assets remain, must not be labeled as customer recordings.

## Cost inputs

No paid telephony resources have been provisioned. Obtain the actual carrier quote for: setup, number rental, channels, outbound/inbound per-minute tariffs, caller-ID verification and any recording/monitoring fee. Obtain infrastructure quotes for: PBX compute, TURN bandwidth, protected storage, backup, retention and administration.

Storage planning is measurable after choosing codec: storage per month = recorded seconds per month × encoded bytes per second, plus replication/backup overhead. Ten agents do not imply ten permanently active calls; size channels and server resources to measured peak concurrency and benchmark them with authorized test calls. Exact total cost cannot be stated before a carrier, cloud tier, codec, call volume and retention period are selected.

## iOS and browser

CRM features can share the existing React Native/web application. Ordinary iOS cellular calls use Apple's system phone flow; Android's InCallService metadata/phone-role features do not run on iOS. Browser audio requires the optional real VoIP/WebRTC architecture above. A tel: link or message composer is a user-confirmed handoff, not evidence that a call/message completed.

