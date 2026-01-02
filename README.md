# 🌍 LINGUA - Real-Time AI Voice Translator

**LINGUA** is a professional-grade, low-latency voice translation application designed for fluid face-to-face conversations. Powered by the **Gemini 2.5 Flash Native Audio** model, it provides near-instant translation with high linguistic accuracy and intelligent UI routing.

## ✨ Key Features

- **Gemini Live Integration**: Utilizes the `@google/genai` Live API for continuous, real-time audio processing and natural-sounding speech output.
- **Dual-Panel Interface**: Features a unique "Face-to-Face" mode where the top panel (Guest) can be flipped 180 degrees, allowing two people to stand opposite each other and read translations comfortably.
- **Intelligent Routing**: Automatically maps translations to the correct panel using metadata tags. User speech is translated to the Guest panel, while Guest speech is translated to the User panel.
- **Bluetooth Optimization**: Includes a dedicated device selector to switch between internal microphones and connected Bluetooth headsets seamlessly, ensuring clear audio capture in any environment.
- **Minimalist Aesthetic**: Features a high-contrast premium dark theme with a clean, typography-focused interface as seen in the screenshot below.

## 📸 Screenshot

![LINGUA Application View](Screenshot%202569-01-02%20at%2008.13.23.png)

*Main Application View: Minimalist face-to-face layout with flipped guest panel and real-time status indicators.*

## 🛠 Tech Stack

- **Frontend**: React 19 (ES6+)
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

1. **Select Languages**: Use the selectors at the top and bottom to set the languages for both participants.
2. **Setup Audio**: Click the **Internal Mic / Bluetooth** badge or the **Settings** icon to select your microphone source.
3. **Start Translating**: Tap the large central **Mic** button. The app will transition to "LISTENING..." mode.
4. **Natural Conversation**: Simply speak. **LINGUA** handles the detection and routing automatically.
5. **Flip for Guest**: Use the **Rotate** button on the left to flip the top panel 180 degrees for your conversation partner.

---
*Built with ❤️ using Gemini 2.5 Flash*