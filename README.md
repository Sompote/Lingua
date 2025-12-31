# 🌍 Lingua - Real-Time AI Voice Translator

**Lingua** is a professional-grade, low-latency voice translation application designed for fluid face-to-face conversations. Powered by the **Gemini 2.5 Flash Native Audio** model, it provides near-instant translation with high linguistic accuracy and intelligent UI routing.

## ✨ Key Features

- **Gemini Live Integration**: Utilizes the `@google/genai` Live API for continuous, real-time audio processing and natural-sounding speech output.
- **Dual-Panel Interface**: Features a unique "Face-to-Face" mode where the top panel (Guest) can be flipped 180 degrees, allowing two people to stand opposite each other and read translations comfortably.
- **Intelligent Routing**: Automatically maps translations to the correct panel based on the spoken language (e.g., User speech translates to the Guest panel and vice versa).
- **Bluetooth Optimization**: Dedicated mic-selection tool allows users to toggle between internal microphones and high-fidelity Bluetooth headsets.
- **Dynamic Waveform Visualization**: Real-time activity monitoring during active translation sessions.
- **High-Contrast Dark Mode**: A sleek, focused design optimized for readability in various lighting conditions.

## 📸 Screenshots

| Dual Mode Interface | Settings & Mic Selection |
| :---: | :---: |
| ![Main App View](https://raw.githubusercontent.com/placeholder/lingua-main.png) | ![Settings View](https://raw.githubusercontent.com/placeholder/lingua-settings.png) |
| *Fluid, face-to-face layout with flipped guest panel* | *Granular control over audio input sources* |

## 🛠 Tech Stack

- **Frontend**: React 19 (ESM)
- **Styling**: Tailwind CSS
- **AI Engine**: [Google Gemini API](https://ai.google.dev/) (@google/genai)
- **Icons**: Lucide React
- **Audio Processing**: Web Audio API (ScriptProcessorNode, AudioContext)

## 🚀 Getting Started

### Prerequisites
- A Google Gemini API Key with access to the `gemini-2.5-flash-native-audio-preview-09-2025` model.
- A modern browser with Microphone permissions enabled.

### Environment Variables
The application expects the following environment variable to be available:
- `process.env.API_KEY`: Your Google Gemini API Key.

## 📖 How to Use

1. **Select Languages**: Set your native language at the bottom and your guest's language at the top.
2. **Connect Mic**: If using Bluetooth headphones, click the **Settings** (gear icon) or the **Bluetooth** badge to ensure the correct input device is selected.
3. **Start Translating**: Press the central blue **Mic** button.
4. **Speak Naturally**: Lingua will listen continuously. Translations for your guest will appear in the top panel, and their responses will appear in your bottom panel.
5. **Flip View**: Use the **Rotate** button to flip the guest panel for easy face-to-face reading.

---
