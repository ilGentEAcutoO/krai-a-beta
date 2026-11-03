"""Syllable counts for the receptionist pace check (B20, scripts/tts-pregen.mjs).

stdin: JSON list of strings -> stdout: JSON list of ints.
Thai: PyThaiNLP syllable_tokenize (engine "dict", no extra deps).
Mandarin: one syllable per Han character.
Other text: vowel groups per word (rough English syllables).
"""
import json
import re
import sys

from pythainlp.tokenize import syllable_tokenize

THAI = re.compile(r"[฀-๿]+")
HAN = re.compile(r"[㐀-鿿]")


def english(text):
    n = 0
    for w in re.findall(r"[A-Za-z']+", text):
        groups = re.findall(r"[aeiouy]+", w.lower())
        k = len(groups)
        if w.lower().endswith("e") and k > 1 and not w.lower().endswith(("le", "ee")):
            k -= 1
        n += max(1, k)
    return n


def count(text):
    n = 0
    for run in THAI.findall(text):
        n += len([s for s in syllable_tokenize(run, engine="dict") if s.strip()])
    # Mandarin: one syllable per Han character.
    n += len(HAN.findall(text))
    n += english(HAN.sub(" ", THAI.sub(" ", text)))
    return n


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    texts = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    print(json.dumps([count(t) for t in texts]))
