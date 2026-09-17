#!/usr/bin/env python3
"""
configure_respeaker_alexa_like.py

One-shot configuration script for the ReSpeaker USB Mic Array (v2.0 / Puck)
to behave more like a far-field voice terminal:

- HPF on mic signals (cut low rumble)
- AGC (auto gain) enabled with sensible limits
- Stationary + non-stationary noise suppression
- Echo / transient echo suppression
- ASR-focused noise suppression path enabled

Run this after the device powers up (settings are not guaranteed to persist
across power cycles).
"""

# --------------------------------------------------------------------
# Backwards-compat shim: older ReSpeaker tuning code uses array.tostring(),
# which was removed in modern Python. We reintroduce it as an alias to
# .tobytes() so the library works without modification.
# --------------------------------------------------------------------
import array as _array

if not hasattr(_array.array, "tostring"):
    def _array_tostring(self):
        return self.tobytes()
    _array.array.tostring = _array_tostring

from tuning import find  # from the usb_4_mic_array repo


def set_param(dev, name, value):
    """Helper to write + read-back a parameter with logging."""
    try:
        dev.write(name, value)
        new_val = dev.read(name)
        print(f"{name:24s} -> {new_val}")
    except Exception as e:
        print(f"FAILED to set {name}: {e}")


def main():
    dev = find()
    if not dev:
        print("No ReSpeaker USB Mic Array found. Is it plugged in?")
        return

    print(f"Found ReSpeaker device, firmware version: {dev.version}")

    print("\n=== Front-end filtering / HPF ===")
    # High-pass Filter on microphone signals.
    # 0 = OFF
    # 1 =  70 Hz cutoff
    # 2 = 125 Hz cutoff  (good compromise for speech)
    # 3 = 180 Hz cutoff  (more aggressive bass cut)
    set_param(dev, "HPFONOFF", 2)

    print("\n=== Automatic Gain Control (AGC) ===")
    # Turn AGC on so quiet speech is boosted, like a smart speaker.
    # 0 = OFF, 1 = ON
    set_param(dev, "AGCONOFF", 1)

    # Maximum AGC gain factor (~31.6 ≈ 30 dB).
    # Range [1 .. 1000]. Too high will raise far background noise.
    set_param(dev, "AGCMAXGAIN", 31.6)

    # Target output level. Default is about -23 dBov (~0.005).
    # You can leave this at default-ish; tweak if you want hotter output.
    set_param(dev, "AGCDESIREDLEVEL", 0.005)

    # Attack / release time-constant (seconds).
    # Lower = faster reaction but more “pumpy”; higher = smoother but slower.
    set_param(dev, "AGCTIME", 0.3)

    print("\n=== Noise suppression (fullband output) ===")
    # Stationary noise suppression ON (fans, HVAC, hum).
    set_param(dev, "STATNOISEONOFF", 1)

    # Non-stationary noise suppression ON (keyboard taps, clunks).
    set_param(dev, "NONSTATNOISEONOFF", 1)

    # Over-subtraction factors (how aggressively noise is removed).
    # 0.0 = off, 1.0–1.5 = moderate, >2 = very aggressive / “underwater”.
    set_param(dev, "GAMMA_NS", 1.0)   # stationary noise
    set_param(dev, "GAMMA_NN", 1.1)   # non-stationary noise

    # Gain floors — prevent total muting so speech stays intelligible.
    # Values around 0.15 (≈ -16 dB) and 0.3 (≈ -10 dB) are good starting points.
    set_param(dev, "MIN_NS", 0.15)
    set_param(dev, "MIN_NN", 0.3)

    print("\n=== Echo / transient suppression ===")
    # Echo suppression ON (reduces far-end speaker audio feeding back).
    set_param(dev, "ECHOONOFF", 1)

    # Transient echo suppression ON (clicks, short echoes).
    set_param(dev, "TRANSIENTONOFF", 1)

    # Non-linear echo attenuation ON (helps with distorted / nonlinear paths).
    set_param(dev, "NLATTENONOFF", 1)

    # Adaptive Echo Canceler freeze:
    # 0 = adaptation enabled (normal)
    # 1 = freeze adaptation (useful only for debugging / special cases)
    set_param(dev, "AECFREEZEONOFF", 0)

    # RT60 estimation ON (room reverberation estimation used internally).
    set_param(dev, "RT60ONOFF", 1)

    print("\n=== ASR-focused noise / VAD path ===")
    # These specifically affect the “for ASR” path (better for transcription).
    set_param(dev, "STATNOISEONOFF_SR", 1)
    set_param(dev, "NONSTATNOISEONOFF_SR", 1)

    # Again, moderate noise suppression for ASR.
    set_param(dev, "GAMMA_NS_SR", 1.0)
    set_param(dev, "GAMMA_NN_SR", 1.1)
    set_param(dev, "MIN_NS_SR", 0.15)
    set_param(dev, "MIN_NN_SR", 0.3)

    # VAD threshold for ASR path.
    # Default is ~3.5 dB. Lower = more sensitive (more false positives),
    # higher = stricter (may miss very quiet speech).
    set_param(dev, "GAMMAVAD_SR", 3.5)

    print("\nConfiguration complete.")
    dev.close()


if __name__ == "__main__":
    main()