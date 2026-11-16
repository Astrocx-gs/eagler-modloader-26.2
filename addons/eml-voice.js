/*
 * Voice chat for eagler-modloader: the browser half (microphone, compression, 3D playback).
 * The game half is the built-in "Voice Chat" mod (loader/voicechat), which calls window.emlVoice
 * through PlatformEmlVoice and carries the audio over the game connection.
 *
 * Audio: 16 kHz mono, 40 ms frames, IMA ADPCM (4 bits a sample, 323 bytes a frame, about 8 KB/s).
 * The browser's own echo cancellation, noise suppression and gain control clean up the microphone.
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
	function schedule(id, pcm, x, y, z) {
		var c = audio();
		if (!c) return;
		var s = speaker(id);
		place(s.panner, x, y, z);
		var b = c.createBuffer(1, FRAME, RATE);
		b.getChannelData(0).set(pcm);
		var src = c.createBufferSource();
		src.buffer = b;
		src.connect(s.panner);
		var now = c.currentTime;
		// a small buffer against network jitter; start over if it ran dry or fell far behind
		if (s.next < now + 0.02 || s.next > now + 0.6) s.next = now + 0.12;
		src.start(s.next);
		s.next += FRAME / RATE;
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

	function onFrame(pcm) {
		var sum = 0;
		for (var i = 0; i < FRAME; i++) sum += pcm[i] * pcm[i];
		var db = 10 * Math.log10(sum / FRAME + 1e-10);
		level = db > level ? db : level * 0.85 + db * 0.15;
		if (testing) { schedule(-1, new Float32Array(pcm), 0, 0, -1); transmitting = false; return; }
		var send = false;
		if (active && settings.enabled) {
			if (settings.mode === 0) {
				send = wantTalk;
			} else if (!settings.muted) {
				if (db > settings.threshold) vadHold = 8; else if (vadHold > 0) vadHold--;
				send = vadHold > 0;
			}
		}
		transmitting = send;
		if (send) {
			queue.push(encode(pcm));
			if (queue.length > 25) queue.shift();
		} else {
			encIndex = 0;
		}
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
		}
	};
})();
