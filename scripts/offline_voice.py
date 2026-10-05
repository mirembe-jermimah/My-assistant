"""Local microphone recognition for Jermi's Assistant. Audio never leaves this process."""

import json
import queue
import sys
import time
import wave
from pathlib import Path


def output(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def transcribe(wav_path, model_path):
    from vosk import KaldiRecognizer, Model, SetLogLevel

    SetLogLevel(-1)
    with wave.open(str(wav_path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError("Expected a mono, 16-bit PCM WAV file")
        recognizer = KaldiRecognizer(Model(str(model_path)), source.getframerate())
        phrases = []
        while chunk := source.readframes(4000):
            if recognizer.AcceptWaveform(chunk):
                phrases.append(json.loads(recognizer.Result()).get("text", ""))
        phrases.append(json.loads(recognizer.FinalResult()).get("text", ""))
        return " ".join(phrase for phrase in phrases if phrase).strip()


def listen(model_path):
    import sounddevice as sd
    from vosk import KaldiRecognizer, Model, SetLogLevel

    SetLogLevel(-1)
    model = Model(str(model_path))
    device = sd.query_devices(None, "input")
    sample_rate = int(device["default_samplerate"])
    audio = queue.Queue()

    def callback(samples, _frames, _time, status):
        if status:
            print(str(status), file=sys.stderr)
        audio.put(bytes(samples))

    recognizer = KaldiRecognizer(model, sample_rate)
    started = time.monotonic()
    last_voice = started
    heard_voice = False
    with sd.RawInputStream(samplerate=sample_rate, blocksize=4000, dtype="int16",
                           channels=1, callback=callback):
        while time.monotonic() - started < 18:
            try:
                chunk = audio.get(timeout=0.5)
            except queue.Empty:
                continue
            if recognizer.AcceptWaveform(chunk):
                phrase = json.loads(recognizer.Result()).get("text", "").strip()
                if phrase:
                    return phrase
            else:
                partial = json.loads(recognizer.PartialResult()).get("partial", "").strip()
                if partial:
                    heard_voice = True
                    last_voice = time.monotonic()
            if not heard_voice and time.monotonic() - started > 9:
                break
            if heard_voice and time.monotonic() - last_voice > 3:
                break
    return json.loads(recognizer.FinalResult()).get("text", "").strip()


def main():
    if len(sys.argv) < 3:
        raise ValueError("Use status, listen, or transcribe with a model path")
    command, model_path = sys.argv[1], Path(sys.argv[2])
    if not model_path.is_dir():
        raise FileNotFoundError("The offline speech model is not installed")
    if command == "status":
        import sounddevice as sd
        device = sd.query_devices(None, "input")
        output({"ready": True, "microphone": device["name"], "engine": "Vosk on-device"})
    elif command == "listen":
        output({"text": listen(model_path)})
    elif command == "transcribe":
        if len(sys.argv) != 4:
            raise ValueError("A WAV file path is required")
        output({"text": transcribe(Path(sys.argv[3]), model_path)})
    else:
        raise ValueError("Unknown voice command")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        output({"error": str(error)})
        sys.exit(1)
