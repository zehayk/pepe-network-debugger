import React from 'react'
import { FolderOpen, ShieldCheck } from 'lucide-react'

const STEPS = {
  Steps: [
    'Click "Open Cert Folder" below.',
    'Double-click mitmproxy-ca-cert.p12.',
    'In the import wizard, select "Local Machine" → Next.',
    'Choose "Place all certificates in the following store" → Trusted Root Certification Authorities.',
    'Finish and restart your browser.',
  ],
  "Proxy Setup": [
    'Open proxy settings in windows (Settings → Network & Internet → Proxy).',
    'Set the proxy host to 127.0.0.1 and the port to 8080.',
  ],
  // Android: [
  //   'Copy mitmproxy-ca-cert.pem to your device (email, USB, or ADB).',
  //   'Settings → Security → Encryption & credentials → Install a certificate → CA certificate.',
  //   'Select the file. Note: apps with network_security_config may still pin their own certs.',
  // ],
  // iOS: [
  //   'AirDrop or email mitmproxy-ca-cert.pem to your device.',
  //   'Tap the file — iOS will prompt to install a profile.',
  //   'Settings → General → VPN & Device Management → trust the mitmproxy profile.',
  //   'Settings → General → About → Certificate Trust Settings → toggle mitmproxy full trust.',
  // ],
}

export default function CertHelpDialog({ onClose }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ maxWidth: 520, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dialog__title"><ShieldCheck size={15} /> Install CA Certificate</div>

        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 16px', lineHeight: 1.6 }}>
          PEPE uses mitmproxy's CA certificate to decrypt HTTPS traffic.
          Install it once per device to eliminate certificate errors in your browser.
          The certificate files are in <code style={{ background: 'var(--panel3)', padding: '1px 4px', borderRadius: 3 }}>~/.mitmproxy/</code>.
        </p>

        {Object.entries(STEPS).map(([platform, steps]) => (
          <div key={platform} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--accent)',
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
            }}>
              {platform}
            </div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {steps.map((s, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--fg-dim)', lineHeight: 1.6, marginBottom: 3 }}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ))}

        <div className="dialog__actions" style={{ marginTop: 4 }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn--accent" onClick={() => window.electron?.openCertFolder()}>
            <FolderOpen size={13} /> Open Cert Folder
          </button>
        </div>
      </div>
    </div>
  )
}
