/*
 * Voice chat for eagler-modloader: the browser half (microphone, compression, 3D playback).
 * The game half is the built-in "Voice Chat" mod (loader/voicechat), which calls window.emlVoice
 * through PlatformEmlVoice and carries the audio over the game connection.
 *
 * Audio: 16 kHz mono, 40 ms frames, IMA ADPCM (4 bits a sample, 323 bytes a frame, about 8 KB/s).
 * The browser's own echo cancellation, noise suppression and gain control clean up the microphone.
 *
 * It also speaks Simple Voice Chat's protocol (versions 18, 20 and 21), for servers that run Simple
 * Voice Chat and were joined through Wispcraft: 48 kHz Opus (WebCodecs), AES (WebCrypto), and UDP
 * through Wispcraft's Wisp proxy (wispcraft.connectUdp).
 *
 * By OmegaCat_1325, with Claude. Apache-2.0, like the rest of eagler-modloader.
 */
(function () {
	"use strict";
	if (typeof window === "undefined" || window.emlVoice) return;

	var RATE = 16000, FRAME = 640, RANGE = 48;
	var KEY = "eml-voice";
	var DEFAULTS = { mode: 0, volume: 1, mic: 1, threshold: -45, enabled: 1, muted: 0 };
	var settings = {};
	(function load() {
		var saved = {};
		try { saved = JSON.parse(window.localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
		for (var k in DEFAULTS) settings[k] = typeof saved[k] === "number" ? saved[k] : DEFAULTS[k];
	})();
	function save() {
		try { window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* private window */ }
	}

	// ---- IMA ADPCM ----
	var STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
		73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
		544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
		3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
		13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
	var INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
	var encIndex = 0;

	function clamp16(v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : v; }

	function encode(pcm) {
		var out = new Uint8Array(3 + (FRAME >> 1));
		var pred = clamp16(Math.round(pcm[0] * 32767)), index = encIndex;
		out[0] = pred & 255; out[1] = (pred >> 8) & 255; out[2] = index;
		for (var i = 1; i < FRAME; i++) {
			var s = clamp16(Math.round(pcm[i] * 32767));
			var step = STEPS[index], diff = s - pred, code = 0;
			if (diff < 0) { code = 8; diff = -diff; }
			var delta = step >> 3;
			if (diff >= step) { code |= 4; diff -= step; delta += step; }
			step >>= 1;
			if (diff >= step) { code |= 2; diff -= step; delta += step; }
			step >>= 1;
			if (diff >= step) { code |= 1; delta += step; }
			pred = clamp16(code & 8 ? pred - delta : pred + delta);
			index += INDEX[code]; index = index < 0 ? 0 : index > 88 ? 88 : index;
			var at = 3 + ((i - 1) >> 1);
			if ((i - 1) & 1) out[at] |= code << 4; else out[at] = code;
		}
		encIndex = index;
		return out.buffer;
	}

	function decode(buf) {
		var b = new Uint8Array(buf), pcm = new Float32Array(FRAME);
		if (b.length < 3 + (FRAME >> 1)) return pcm;
		var pred = (b[0] | (b[1] << 8)) << 16 >> 16, index = Math.min(88, b[2]);
		pcm[0] = pred / 32768;
		for (var i = 1; i < FRAME; i++) {
			var at = 3 + ((i - 1) >> 1);
			var code = (i - 1) & 1 ? b[at] >> 4 : b[at] & 15;
			var step = STEPS[index], delta = step >> 3;
			if (code & 4) delta += step;
			if (code & 2) delta += step >> 1;
			if (code & 1) delta += step >> 2;
			pred = clamp16(code & 8 ? pred - delta : pred + delta);
			index += INDEX[code]; index = index < 0 ? 0 : index > 88 ? 88 : index;
			pcm[i] = pred / 32768;
		}
		return pcm;
	}

	// ---- audio output ----
	var ctx = null, master = null;
	function audio() {
		if (!ctx) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return null;
			try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { return null; }
			master = ctx.createGain();
			master.gain.value = settings.volume;
			master.connect(ctx.destination);
		}
		if (ctx.state === "suspended") ctx.resume().catch(function () { });
		return ctx;
	}

	var speakers = {};
	function speaker(id) {
		var s = speakers[id];
		if (!s) {
			var p = ctx.createPanner();
			p.panningModel = "HRTF";
			p.distanceModel = "linear";
			p.refDistance = 4;
			p.maxDistance = RANGE;
			p.rolloffFactor = 1;
			p.connect(master);
			s = speakers[id] = { panner: p, next: 0, heard: 0 };
		}
		return s;
	}
	function place(p, x, y, z) {
		if (p.positionX) {
			var t = ctx.currentTime;
			p.positionX.setTargetAtTime(x, t, 0.03);
			p.positionY.setTargetAtTime(y, t, 0.03);
			p.positionZ.setTargetAtTime(z, t, 0.03);
		} else {
			p.setPosition(x, y, z);
		}
	}
	function schedule(id, pcm, x, y, z, rate) {
		var c = audio();
		if (!c || !pcm.length) return;
		var s = speaker(id);
		if (x !== null) place(s.panner, x, y, z);
		rate = rate || RATE;
		var b = c.createBuffer(1, pcm.length, rate);
		b.getChannelData(0).set(pcm);
		var src = c.createBufferSource();
		src.buffer = b;
		src.connect(s.panner);
		var now = c.currentTime;
		// a small buffer against network jitter; start over if it ran dry or fell far behind
		if (s.next < now + 0.02 || s.next > now + 0.6) s.next = now + 0.12;
		src.start(s.next);
		s.next += pcm.length / rate;
		s.heard = Date.now();
	}
	setInterval(function () {
		var old = Date.now() - 30000;
		for (var id in speakers) {
			if (speakers[id].heard < old) {
				try { speakers[id].panner.disconnect(); } catch (e) { }
				delete speakers[id];
			}
		}
	}, 10000);

	// ---- microphone ----
	var MIC_CLOSED = 0, MIC_OPENING = 1, MIC_OPEN = 2, MIC_BLOCKED = -1;
	var mic = MIC_CLOSED, deniedAt = 0, stream = null, nodes = [];
	var acc = 0, accN = 0, phase = 0, frame = new Float32Array(FRAME), frameLen = 0;
	var queue = [], level = -100, vadHold = 0;
	var wantTalk = false, active = false, testing = false, transmitting = false, inactiveSince = 0;

	function openMic() {
		if (mic === MIC_OPEN || mic === MIC_OPENING) return;
		if (mic === MIC_BLOCKED && Date.now() - deniedAt < 3000) return;
		var md = navigator.mediaDevices;
		if (!md || !md.getUserMedia || !audio()) { mic = MIC_BLOCKED; deniedAt = Date.now(); return; }
		mic = MIC_OPENING;
		md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(function (s) {
			if (mic !== MIC_OPENING) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
			stream = s;
			var c = audio(), src = c.createMediaStreamSource(s), proc = c.createScriptProcessor(2048, 1, 1), sink = c.createGain();
			sink.gain.value = 0; // the processor only runs while connected to the output
			proc.onaudioprocess = onAudio;
			src.connect(proc); proc.connect(sink); sink.connect(c.destination);
			nodes = [src, proc, sink];
			acc = accN = phase = frameLen = 0;
			mic = MIC_OPEN;
		}, function (e) {
			console.warn("[voice chat] no microphone:", e && e.name ? e.name : e);
			mic = MIC_BLOCKED; deniedAt = Date.now();
		});
	}

	function closeMic() {
		if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
		nodes.forEach(function (n) { try { n.disconnect(); } catch (e) { } });
		stream = null; nodes = []; queue.length = 0; transmitting = false; level = -100;
		if (mic !== MIC_BLOCKED) mic = MIC_CLOSED;
	}

	function onAudio(e) {
		var input = e.inputBuffer.getChannelData(0), step = ctx.sampleRate / RATE, gain = settings.mic;
		if (svc) { onAudio48(input, gain); return; }
		for (var i = 0; i < input.length; i++) {
			// averaging down to 16 kHz (also filters out what 16 kHz can't carry)
			acc += input[i]; accN++; phase += 1;
			if (phase >= step) {
				phase -= step;
				var v = acc / accN * gain;
				frame[frameLen++] = v > 1 ? 1 : v < -1 ? -1 : v;
				acc = 0; accN = 0;
				if (frameLen === FRAME) { onFrame(frame); frameLen = 0; }
			}
		}
	}

	/** Measures a frame and decides whether to send it (push-to-talk, or voice activation with a hold). */
	function decide(pcm, holdFrames) {
		var sum = 0, n = pcm.length;
		for (var i = 0; i < n; i++) sum += pcm[i] * pcm[i];
		var db = 10 * Math.log10(sum / n + 1e-10);
		level = db > level ? db : level * 0.85 + db * 0.15;
		var send = false;
		if (!testing && active && settings.enabled) {
			if (settings.mode === 0) {
				send = wantTalk;
			} else if (!settings.muted) {
				if (db > settings.threshold) vadHold = holdFrames; else if (vadHold > 0) vadHold--;
				send = vadHold > 0;
			}
		}
		transmitting = send;
		return send;
	}

	function onFrame(pcm) {
		var send = decide(pcm, 8);
		if (testing) { schedule(-1, new Float32Array(pcm), 0, 0, -1); return; }
		if (send) {
			queue.push(encode(pcm));
			if (queue.length > 25) queue.shift();
		} else {
			encIndex = 0;
		}
	}

	// ---- Simple Voice Chat ----
	// Servers with the Simple Voice Chat mod or plugin, joined through Wispcraft. The game does the
	// handshake over the game connection and hands over the secret (svcStart); the audio goes over UDP,
	// which a browser can only reach through Wispcraft's Wisp proxy, encrypted with AES and compressed
	// with Opus (WebCodecs). Protocol versions 18 (voice chat 2.5.x), 20 (2.6.x) and 21 (2.7.x).
	var SVC_RATE = 48000, SVC_FRAME = 960;
	var svc = null;
	var r48 = { t: 0, last: 0, frame: new Float32Array(SVC_FRAME), len: 0 };

	function onAudio48(input, gain) {
		var step = ctx.sampleRate / SVC_RATE, t = r48.t, prev = r48.last, n = input.length;
		// linear interpolation to 48 kHz; t counts input samples, t < 0 is between the last block and this one
		while (t <= n - 1) {
			var v;
			if (t < 0) v = prev + (input[0] - prev) * (t + 1);
			else { var i = t | 0, f = t - i; v = i + 1 < n ? input[i] + (input[i + 1] - input[i]) * f : input[i]; }
			v *= gain;
			r48.frame[r48.len++] = v > 1 ? 1 : v < -1 ? -1 : v;
			if (r48.len === SVC_FRAME) { onFrame48(r48.frame); r48.len = 0; }
			t += step;
		}
		r48.t = t - n; r48.last = input[n - 1];
	}

	function onFrame48(pcm) {
		var send = decide(pcm, 16);
		if (testing) { schedule(-1, new Float32Array(pcm), 0, 0, -1, SVC_RATE); return; }
		var c = svc;
		if (!send || !c || c.state !== 2 || !c.encoder) return;
		try {
			var data = new AudioData({ format: "f32", sampleRate: SVC_RATE, numberOfFrames: SVC_FRAME, numberOfChannels: 1, timestamp: c.ts, data: new Float32Array(pcm) });
			c.ts += 20000;
			c.encoder.encode(data);
			data.close();
		} catch (e) {
			console.warn("[voice chat] couldn't compress the microphone:", e);
		}
	}

	function W() { this.a = []; }
	W.prototype = {
		u8: function (v) { this.a.push(v & 255); return this; },
		bytes: function (b) { for (var i = 0; i < b.length; i++) this.a.push(b[i]); return this; },
		varint: function (v) { while (v & ~127) { this.a.push((v & 127) | 128); v >>>= 7; } this.a.push(v); return this; },
		array: function (b) { return this.varint(b.length).bytes(b); },
		long: function (v) { var hi = Math.floor(v / 4294967296), lo = v >>> 0; return this.u8(hi >>> 24).u8(hi >>> 16).u8(hi >>> 8).u8(hi).u8(lo >>> 24).u8(lo >>> 16).u8(lo >>> 8).u8(lo); },
		done: function () { return new Uint8Array(this.a); }
	};
	function R(b) { this.b = b; this.p = 0; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
	R.prototype = {
		u8: function () { if (this.p >= this.b.length) throw new Error("short packet"); return this.b[this.p++]; },
		varint: function () { var v = 0, s = 0, x; do { x = this.u8(); v |= (x & 127) << s; s += 7; } while (x & 128 && s < 35); return v >>> 0; },
		bytes: function (n) { if (this.p + n > this.b.length) throw new Error("short packet"); var r = this.b.subarray(this.p, this.p + n); this.p += n; return r; },
		array: function (max) { var n = this.varint(); if (n > max) throw new Error("too long"); return this.bytes(n); },
		long: function () { var hi = this.v.getInt32(this.p), lo = this.v.getUint32(this.p + 4); this.p += 8; return hi * 4294967296 + lo; },
		float: function () { var f = this.v.getFloat32(this.p); this.p += 4; return f; },
		double: function () { var f = this.v.getFloat64(this.p); this.p += 8; return f; },
		uuid: function () { return uuidString(this.bytes(16)); }
	};
	function hexBytes(h) { h = h.replace(/-/g, ""); var b = new Uint8Array(h.length >> 1); for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }
	function uuidString(b) {
		var h = "";
		for (var i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
		return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) + "-" + h.substr(20);
	}

	function svcFail(c, state, why) {
		if (c.state === state) return;
		console.warn("[voice chat] Simple Voice Chat: " + why);
		svcClose(c);
		c.state = state;
	}

	function svcClose(c) {
		c.closed = true;
		clearInterval(c.timer);
		try { if (c.encoder && c.encoder.state !== "closed") c.encoder.close(); } catch (e) { }
		for (var k in c.spk) { try { c.spk[k].dec.close(); } catch (e) { } }
		c.spk = {};
		try { if (c.writer) c.writer.close().catch(function () { }); } catch (e) { }
		try { if (c.reader) c.reader.cancel().catch(function () { }); } catch (e) { }
	}

	function svcEncrypt(c, plain) {
		var iv = crypto.getRandomValues(new Uint8Array(c.version >= 20 ? 12 : 16));
		var alg = c.version >= 20 ? { name: "AES-GCM", iv: iv, tagLength: 128 } : { name: "AES-CBC", iv: iv };
		return crypto.subtle.encrypt(alg, c.key, plain).then(function (enc) {
			var out = new Uint8Array(iv.length + enc.byteLength);
			out.set(iv); out.set(new Uint8Array(enc), iv.length);
			return out;
		});
	}

	function svcDecrypt(c, payload) {
		var n = c.version >= 20 ? 12 : 16;
		var iv = payload.slice(0, n), data = payload.slice(n);
		var alg = c.version >= 20 ? { name: "AES-GCM", iv: iv, tagLength: 128 } : { name: "AES-CBC", iv: iv };
		return crypto.subtle.decrypt(alg, c.key, data).then(function (b) { return new Uint8Array(b); });
	}

	/** Sends a voice packet: its id and body, encrypted, behind the magic byte and who it's from. */
	function svcSend(c, id, body) {
		var plain = new W().u8(id).bytes(body || []).done();
		c.out = c.out.then(function () {
			if (c.closed) return;
			return svcEncrypt(c, plain).then(function (enc) {
				var pkt = new W().u8(255).bytes(c.version >= 21 ? c.connection : c.player).array(enc).done();
				if (!c.closed) return c.writer.write(pkt);
			});
		}).catch(function (e) { if (!c.closed) svcFail(c, 3, "couldn't send: " + (e && e.message || e)); });
	}

	function svcAuth(c) {
		if (c.closed || c.state === 2) return;
		if (Date.now() - c.started > 20000) {
			svcFail(c, 4, "the voice server at " + c.host + ":" + c.port + " didn't answer (the Wisp proxy may not allow UDP, or the port is closed)");
			return;
		}
		if (!c.authed) {
			svcSend(c, 5, c.version >= 21 ? [] : new W().bytes(c.player).bytes(c.secret).done());
		} else {
			svcSend(c, 9, c.version >= 21 ? c.nonce : []);
		}
	}

	function svcReceive(c, data) {
		var r = new R(data);
		if (r.u8() !== 255) return;
		var payload = r.array(2048);
		c.in = c.in.then(function () {
			if (c.closed) return;
			return svcDecrypt(c, payload).then(function (plain) { svcHandle(c, plain); }, function () { /* not for us */ });
		}).catch(function (e) { console.warn("[voice chat] bad voice packet:", e && e.message || e); });
	}

	function svcHandle(c, plain) {
		var r = new R(plain), id = r.u8();
		switch (id) {
		case 6: // authenticated
			if (!c.authed) { c.authed = true; if (c.version >= 21) c.nonce = new Uint8Array(r.bytes(16)); svcAuth(c); }
			break;
		case 10: // connection checked
			if (c.authed && c.state !== 2) { c.state = 2; c.lastKeepAlive = Date.now(); console.log("[voice chat] connected to Simple Voice Chat at " + c.host + ":" + c.port); }
			break;
		case 8: // keep alive
			c.lastKeepAlive = Date.now();
			svcSend(c, 8);
			break;
		case 7: // ping
			svcSend(c, 7, plain.subarray(1));
			break;
		case 2: case 3: case 4: { // player, group, location sound
			var channel = r.uuid(), sender = r.uuid(), loc = null;
			if (id === 4) loc = [r.double(), r.double(), r.double()];
			var opus = r.array(1275), seq = r.long(), distance = id === 3 ? 0 : r.float();
			if (seq < 0) return; // raw audio only used inside the Java client
			svcSound(c, id, channel, sender, opus, seq, distance, loc);
			break;
		}
		}
	}

	function svcSound(c, kind, channel, sender, opus, seq, distance, loc) {
		if (!settings.enabled || typeof AudioDecoder === "undefined" || !audio()) return;
		var s = c.spk[channel];
		if (!s) {
			s = c.spk[channel] = { id: "svc:" + channel, last: -1, ts: 0, dec: null };
			s.dec = new AudioDecoder({
				output: function (ad) {
					var pcm = new Float32Array(ad.numberOfFrames);
					try { ad.copyTo(pcm, { planeIndex: 0, format: "f32-planar" }); } catch (e) { ad.close(); return; }
					var rate = ad.sampleRate;
					ad.close();
					if (!c.closed) schedule(s.id, pcm, null, 0, 0, rate);
				},
				error: function (e) { console.warn("[voice chat] couldn't decode a voice:", e); delete c.spk[channel]; }
			});
			s.dec.configure({ codec: "opus", sampleRate: SVC_RATE, numberOfChannels: 1 });
		}
		if (seq <= s.last && s.last - seq < 1000) return; // late
		s.last = seq; s.kind = kind; s.sender = sender; s.loc = loc; s.distance = distance; s.heard = Date.now();
		svcPlace(c, s);
		try {
			s.dec.decode(new EncodedAudioChunk({ type: "key", timestamp: s.ts, data: opus }));
			s.ts += 20000;
		} catch (e) { /* closed */ }
	}

	/** Puts a voice where its speaker is, as seen from the camera (x right, y up, -z ahead). */
	function svcPlace(c, s) {
		var sp = speaker(s.id), p = sp.panner, at = s.kind === 4 ? s.loc : s.kind === 2 ? c.pos[s.sender] : null, l = c.lis;
		if (s.distance > 0) { p.maxDistance = s.distance; p.refDistance = Math.min(4, s.distance / 4); }
		if (!at || !l) { place(p, 0, 0, -1); return; }
		var dx = at[0] - l[0], dy = at[1] - l[1], dz = at[2] - l[2], yaw = l[3] * Math.PI / 180;
		var forward = -Math.sin(yaw) * dx + Math.cos(yaw) * dz, right = -Math.cos(yaw) * dx - Math.sin(yaw) * dz;
		place(p, right, dy, -forward);
	}

	function svcStart(version, host, port, secretHex, player, connection, keepAlive) {
		if (svc) { svcClose(svc); svc = null; }
		var c = svc = {
			version: version, host: host, port: port, secret: hexBytes(secretHex), player: hexBytes(player),
			connection: connection ? hexBytes(connection) : null, keepAlive: keepAlive || 1000,
			state: 1, authed: false, nonce: null, closed: false, started: Date.now(), lastKeepAlive: 0,
			out: Promise.resolve(), in: Promise.resolve(), spk: {}, pos: {}, lis: null, ts: 0, encoder: null
		};
		var wc = window.wispcraft;
		if (!wc || typeof wc.connectUdp !== "function") { svcFail(c, 3, "Wispcraft isn't in this page"); return; }
		if (!window.crypto || !crypto.subtle) { svcFail(c, 3, "this page isn't on https, so the browser won't encrypt"); return; }
		if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") { svcFail(c, 3, "this browser can't do Opus audio (WebCodecs)"); return; }
		try {
			c.encoder = new AudioEncoder({
				output: function (chunk) {
					var b = new Uint8Array(chunk.byteLength);
					chunk.copyTo(b);
					if (c.state === 2) svcSend(c, 1, new W().array(b).long(c.seq++).u8(0).done());
				},
				error: function (e) { console.warn("[voice chat] microphone compression stopped:", e); c.encoder = null; }
			});
			c.encoder.configure({ codec: "opus", sampleRate: SVC_RATE, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000 } });
			c.seq = 0;
		} catch (e) { svcFail(c, 3, "Opus isn't supported here: " + e); return; }
		crypto.subtle.importKey("raw", c.secret, { name: version >= 20 ? "AES-GCM" : "AES-CBC" }, false, ["encrypt", "decrypt"]).then(function (key) {
			c.key = key;
			return wc.connectUdp(host + ":" + port);
		}).then(function (stream) {
			if (c.closed) { try { stream.write.getWriter().close(); } catch (e) { } return; }
			c.writer = stream.write.getWriter();
			c.reader = stream.read.getReader();
			(function read() {
				c.reader.read().then(function (r) {
					if (r.done) { if (!c.closed) svcFail(c, 5, "the voice connection closed"); return; }
					try { svcReceive(c, r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value)); } catch (e) { }
					read();
				}, function (e) { if (!c.closed) svcFail(c, 5, "the voice connection broke: " + (e && e.message || e)); });
			})();
			svcAuth(c);
			c.timer = setInterval(function () {
				if (c.state === 2) {
					if (Date.now() - c.lastKeepAlive > c.keepAlive * 10) svcFail(c, 5, "the voice server stopped answering");
				} else svcAuth(c);
			}, 1000);
		}).catch(function (e) {
			if (!c.closed) svcFail(c, 3, "couldn't open UDP through Wispcraft (" + (e && e.message || e) + "); the Wisp proxy may not allow UDP");
		});
	}

	// ---- what the game calls (see PlatformEmlVoice) ----
	window.emlVoice = {
		available: function () {
			return !!(window.AudioContext || window.webkitAudioContext);
		},
		/** Called every game tick. Returns 0 not in a voice world, 1 idle, 2 talking, 3 no microphone, 4 voice chat off, 5 microphone muted. */
		tick: function (talk, inVoiceWorld) {
			wantTalk = !!talk;
			active = !!inVoiceWorld;
			if (!active) {
				queue.length = 0; transmitting = false;
				if (!inactiveSince) inactiveSince = Date.now();
				if (mic === MIC_OPEN && !testing && Date.now() - inactiveSince > 5000) closeMic();
				return 0;
			}
			inactiveSince = 0;
			if (!settings.enabled) { queue.length = 0; transmitting = false; return 4; }
			if (settings.mode === 1 ? !settings.muted : wantTalk) openMic();
			if (mic === MIC_BLOCKED) return 3;
			if (settings.mode === 1 && settings.muted) return 5;
			return transmitting ? 2 : 1;
		},
		/** The next recorded frame to send, or null. */
		poll: function () {
			return queue.length ? queue.shift() : null;
		},
		/** Plays a frame from player `id`, at (x, y, z) blocks from the listener (x right, y up, -z ahead). */
		play: function (id, buf, x, y, z) {
			if (!settings.enabled) return;
			schedule(id, decode(buf), x, y, z);
		},
		get: function (name) {
			return typeof settings[name] === "number" ? settings[name] : 0;
		},
		set: function (name, value) {
			if (!(name in DEFAULTS)) return;
			settings[name] = +value;
			if (name === "volume" && master) master.gain.value = settings.volume;
			save();
		},
		/** Microphone loudness from 0 to 1 (for the settings screen). */
		level: function () {
			return mic === MIC_OPEN ? Math.max(0, Math.min(1, (level + 60) / 60)) : 0;
		},
		/** Hear yourself, to try out the microphone; nothing is sent meanwhile. */
		test: function (on) {
			testing = !!on;
			if (testing) openMic();
		},
		micBlocked: function () {
			return mic === MIC_BLOCKED;
		},

		/** The server Wispcraft connected to last: "name|host" (host after the SRV lookup), or "". */
		svcHost: function () {
			var h = window.wispcraft && window.wispcraft.serverHost;
			return h ? h.name + "|" + h.host : "";
		},
		/** Connects to a Simple Voice Chat server with what its secret packet said. */
		svcStart: function (version, host, port, secretHex, player, connection, keepAlive) {
			svcStart(version, host, port, secretHex, player, connection, keepAlive);
		},
		svcStop: function () {
			if (svc) { svcClose(svc); svc = null; }
		},
		/** 0 none, 1 connecting, 2 connected, 3 can't connect from this browser, 4 no answer, 5 connection lost. */
		svcStatus: function () {
			return svc ? svc.state : 0;
		},
		/** Where the camera is (world coordinates) and which way it faces. */
		svcListener: function (x, y, z, yaw) {
			if (!svc) return;
			svc.lis = [x, y, z, yaw];
			var old = Date.now() - 1000;
			for (var k in svc.spk) if (svc.spk[k].heard > old) svcPlace(svc, svc.spk[k]);
		},
		/** Where a talking player's head is (world coordinates). */
		svcPlayerPos: function (uuid, x, y, z) {
			if (svc) svc.pos[uuid] = [x, y, z];
		},
		/** The players heard in the last 0.4 s, comma separated. */
		svcSpeakers: function () {
			if (!svc) return "";
			var out = [], old = Date.now() - 400;
			for (var k in svc.spk) { var s = svc.spk[k]; if (s.heard > old && out.indexOf(s.sender) < 0) out.push(s.sender); }
			return out.join(",");
		}
	};
})();
