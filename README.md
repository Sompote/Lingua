
# 🌍 lingual.ai - Real-Time AI Voice Translator

**lingual.ai** is a professional-grade, low-latency voice translation application designed for fluid face-to-face conversations. Powered by the **Gemini 2.5 Flash Native Audio** model, it provides near-instant translation with high linguistic accuracy and intelligent UI routing.

## ✨ Key Features

- **Gemini Live Integration**: Utilizes the `@google/genai` Live API for continuous, real-time audio processing and natural-sounding speech output.
- **Dual-Panel Interface**: Features a unique "Face-to-Face" mode where the top panel (Guest) can be flipped 180 degrees, allowing two people to stand opposite each other and read translations comfortably.
- **Intelligent Routing**: Automatically maps translations to the correct panel using metadata tags. User speech is translated and routed to the Guest (top) panel, while Guest speech is translated and routed to the User (bottom) panel.
- **Bluetooth Optimization**: Built specifically for travelers and professionals using Bluetooth headphones. Includes a dedicated device selector to switch between internal microphones and connected headsets seamlessly.
- **Live Subtitle-Style Display**: Shows only the latest translation for each person to keep the interface clean and clutter-free.
- **Minimalist Aesthetic**: Features a high-contrast dark theme with a prominent **lingual.ai** brand identity.

## 📸 Screenshot

![lingual.ai Screenshot](Screenshot%202568-12-31%20at%2013.27.13.png)

*Main Application View: Face-to-face layout with flipped guest panel for seamless interaction.*

## 🛠 Tech Stack

- **Frontend**: React 19 (ES6+)
- **Styling**: Tailwind CSS
- **AI Engine**: [Google Gemini API](https://ai.google.dev/) (`gemini-2.5-flash-native-audio-preview-09-2025`)
- **Icons**: Lucide React
- **Audio Processing**: Web Audio API

## 🚀 Getting Started

### Prerequisites
- A Google Gemini API Key with access to the Native Audio model.
- A modern browser with Microphone permissions enabled.

### Environment Variables
The application expects the following environment variable to be available:
- `process.env.API_KEY`: Your Google Gemini API Key.

## 📖 How to Use

1. **Select Languages**: Use the flag dropdowns at the top and bottom to set the languages.
2. **Setup Audio**: Click the **Settings** or **Bluetooth** badge to select your microphone source.
3. **Start Translating**: Tap the large central **Mic** button.
4. **Flip for Guest**: Use the **Rotate** button to flip the guest panel for easier reading.

---
*Built with ❤️ using Gemini 2.5 Flash*
