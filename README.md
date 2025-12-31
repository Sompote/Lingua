# 🌍 Lingua - Real-Time AI Voice Translator

**Lingua** is a professional-grade, low-latency voice translation application designed for fluid face-to-face conversations. Powered by the **Gemini 2.5 Flash Native Audio** model, it provides near-instant translation with high linguistic accuracy and intelligent UI routing.

## ✨ Key Features

- **Gemini Live Integration**: Utilizes the `@google/genai` Live API for continuous, real-time audio processing and natural-sounding speech output.
- **Dual-Panel Interface**: Features a unique "Face-to-Face" mode where the top panel (Guest) can be flipped 180 degrees, allowing two people to stand opposite each other and read translations comfortably.
- **Intelligent Routing**: Automatically maps translations to the correct panel using metadata tags. User speech is translated and routed to the Guest (top) panel, while Guest speech is translated and routed to the User (bottom) panel.
- **Bluetooth Optimization**: Built specifically for travelers and professionals using Bluetooth headphones. Includes a dedicated device selector to switch between internal microphones and connected headsets seamlessly.
- **Live Transcription**: Displays real-time transcripts for both participants, ensuring clarity even in noisy environments.
- **Minimalist Aesthetic**: Features a high-contrast dark theme with a prominent "Lingua" brand identity in the upper-left corner for professional appeal.

## 📸 Screenshots

| Dual Mode Interface | Settings & Mic Selection |
| :---: | :---: |
| ![Main App View](Screenshot%202568-12-31%20at%2013.27.13.png) | ![Settings View](Screenshot%202568-12-31%20at%2013.27.21.png) |
| *Fluid, face-to-face layout with the Lingua logo and flipped guest panel* | *Granular control over audio input sources and Bluetooth headsets* |

## 🛠 Tech Stack

- **Frontend**: React 19 (ESM)
- **Styling**: Tailwind CSS
- **AI Engine**: [Google Gemini API](https://ai.google.dev/) (`gemini-2.5-flash-native-audio-preview-09-2025`)
- **Icons**: Lucide React
- **Audio Processing**: Web Audio API (ScriptProcessorNode, AudioContext)

## 🚀 Getting Started

### Prerequisites
- A Google Gemini API Key with access to the Native Audio model.
- A modern browser with Microphone permissions enabled.

### Environment Variables
The application expects the following environment variable to be available:
- `process.env.API_KEY`: Your Google Gemini API Key.

## 📖 How to Use

1. **Select Languages**: Set your native language at the bottom and your guest's language at the top using the flag dropdowns.
2. **Configure Audio**: Click the **Settings** (gear icon) or the **Bluetooth** badge to select your preferred microphone. If using Bluetooth headphones, ensure they are paired with your device first.
3. **Start Translating**: Press the central blue **Mic** button to begin a live session.
4. **Speak Naturally**: Lingua listens continuously. When you speak, the translation appears in the top panel. When your guest speaks, the translation appears in your bottom panel.
5. **Flip View**: Use the **Rotate** button on the left to flip the top panel 180 degrees for face-to-face interaction.

---
*Built with ❤️ using Gemini 2.5 Flash*
