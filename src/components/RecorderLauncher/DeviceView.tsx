import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import "./DeviceView.css";

interface Props {
  onBack: () => void;
}

export default function DeviceView({ onBack }: Props) {
  const [selectedOs, setSelectedOs] = useState<"none" | "ios" | "android">("none");
  const [detectedDevice, setDetectedDevice] = useState<string>("No device detected.");

  return (
    <div className="device-view-container">
      {/* Top Header */}
      <div className="device-view-header">
        <h2 className="device-view-title">Recording Device</h2>
        <div className="device-dropdown-wrap">
          <select
            className="device-select-input"
            value={detectedDevice}
            onChange={(e) => setDetectedDevice(e.target.value)}
          >
            <option value="No device detected.">No device detected.</option>
            <option value="Android - Galaxy S23 (USB)">Android - Galaxy S23 (USB)</option>
            <option value="iOS - iPhone 15 Pro (USB)">iOS - iPhone 15 Pro (USB)</option>
          </select>
        </div>
      </div>

      {selectedOs === "none" ? (
        /* OS Selection Cards (image_1.png) */
        <div className="os-selection-content">
          <div className="os-cards-container">
            {/* iOS Card */}
            <div
              className="os-card"
              onClick={() => setSelectedOs("ios")}
            >
              <div className="os-card-label">iOS</div>
              <div className="phone-frame ios-frame">
                <div className="dynamic-island" />
                <div className="phone-screen">
                  <svg className="apple-logo" viewBox="0 0 170 170" fill="currentColor">
                    <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.34.13-9.16-1.9-14.49-6.1-3.26-2.63-7.14-7.27-11.66-13.93-6.63-9.76-11.87-20.57-15.72-32.41-3.85-11.84-5.78-23.36-5.78-34.56 0-14.23 3.65-26.17 10.95-35.81 7.3-9.64 16.3-14.54 27.01-14.7 4.58 0 9.77 1.25 15.58 3.75 5.81 2.5 9.94 3.75 12.39 3.75 2.17 0 6.43-1.32 12.78-3.96 6.35-2.64 11.61-3.88 15.78-3.72 10.65.54 19.34 4.57 26.07 12.09-9.56 5.76-14.23 13.94-14.01 24.54.22 8.36 3.48 15.42 9.78 21.18 6.3 5.76 13.78 8.97 22.44 9.63-2.39 7.06-5.65 14.45-9.78 22.17zM119.22 31.84c0-7.06 2.55-13.88 7.66-20.45 5.11-6.57 11.58-10.45 19.41-11.63.22.98.33 1.9.33 2.77 0 7.17-2.66 14.12-7.98 20.85-5.32 6.73-11.84 10.51-19.56 11.34-.11-.87-.17-1.84-.17-2.88z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Android Card */}
            <div
              className="os-card"
              onClick={() => setSelectedOs("android")}
            >
              <div className="os-card-label">Android</div>
              <div className="phone-frame android-frame">
                <div className="punch-hole" />
                <div className="phone-screen">
                  <svg className="android-logo" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 18c0 .55.45 1 1 1h1v3c0 .55.45 1 1 1s1-.45 1-1v-3h4v3c0 .55.45 1 1 1s1-.45 1-1v-3h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-4.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 2.23 12.97 2 12 2c-.97 0-1.85.23-2.64.63L7.88 1.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C6.88 4.25 5.5 6.01 5.5 8h13c0-1.99-1.38-3.75-2.97-4.84zM10 5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <p className="os-prompt-text">
            Please select your device's operating system
          </p>

          <div className="os-compatible-links">
            View <a href="#ios" onClick={(e) => { e.preventDefault(); setSelectedOs("ios"); }}>iOS Compatible Devices</a> and{" "}
            <a href="#android" onClick={(e) => { e.preventDefault(); setSelectedOs("android"); }}>Android Compatible Devices</a>
          </div>

          <button className="device-back-btn" onClick={onBack}>
            <ChevronLeft size={15} /> Back to Launcher
          </button>
        </div>
      ) : (
        /* Step-by-Step USB Connection Guide (image_2.png) */
        <div className="device-guide-content">
          <button className="guide-back-link" onClick={() => setSelectedOs("none")}>
            <ChevronLeft size={14} /> Back
          </button>

          <div className="guide-steps-container">
            {/* Step 1 */}
            <div className="guide-step-card">
              <span className="step-label">Step 1</span>
              <div className="step-phone-illustration">
                <div className="phone-mockup-inner">
                  <div className="mockup-header">Developer options</div>
                  <div className="mockup-item highlighted">
                    <span>USB debugging</span>
                    <div className="mockup-switch active" />
                  </div>
                  <div className="mockup-touch-pointer" />
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="guide-step-card">
              <span className="step-label">Step 2</span>
              <div className="step-phone-illustration">
                <div className="phone-mockup-inner">
                  <div className="mockup-dialog">
                    <div className="dialog-title">Allow USB debugging?</div>
                    <div className="dialog-body">USB debugging is intended for development purposes only.</div>
                    <div className="dialog-buttons">
                      <span>Cancel</span>
                      <span className="dialog-ok">OK</span>
                    </div>
                  </div>
                  <div className="mockup-touch-pointer cursor-ok" />
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="guide-step-card">
              <span className="step-label">Step 3</span>
              <div className="step-phone-illustration">
                <div className="phone-mockup-inner">
                  <div className="mockup-dialog">
                    <div className="dialog-title">Default USB configuration</div>
                    <div className="dialog-radio selected">
                      <span className="radio-dot" /> Transferring files
                    </div>
                    <div className="dialog-radio">
                      <span className="radio-dot-off" /> USB tethering
                    </div>
                  </div>
                  <div className="mockup-touch-pointer cursor-radio" />
                </div>
              </div>
            </div>
          </div>

          <div className="guide-instructions-footer">
            <h3>Connect Your {selectedOs === "ios" ? "iOS" : "Android or Tablet"} Device via USB.</h3>
            <ol>
              <li>
                <strong>Enable Developer Options:</strong> <a href="#dev">How to enable Developer Mode.</a>
              </li>
              <li>
                <strong>Enable USB Debugging:</strong> In Developer Options, find and turn on USB Debugging.
              </li>
              <li>
                <strong>USB connection:</strong> Connect your phone to the computer with a USB cable. On your phone, allow USB Debugging. <a href="#help">Still not recognized?</a>
              </li>
            </ol>

            <a href="#not-recognized" className="not-recognized-link">
              {selectedOs === "ios" ? "iOS" : "Android"} device not recognized?
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
