const { exec } = require('child_process');

/**
 * Sends a media key press using PowerShell and user32.dll keybd_event.
 * This is more robust than WScript.Shell.SendKeys as it works globally 
 * even if the app process is in the background.
 */
const sendKey = (vkCode) => {
    // 0xKEY, 0 (scan), 1 (EXTENDED_KEY) | 0 (DOWN), 0 (extra)
    // 0xKEY, 0 (scan), 1 (EXTENDED_KEY) | 2 (UP), 0 (extra)
    // Note: We use -WindowStyle Hidden to minimize flickering
    const psScript = `
$code = @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
'@
$win32 = Add-Type -MemberDefinition $code -Name "Win32" -Namespace Win32 -PassThru
$win32::keybd_event(${vkCode}, 0, 0, 0)
$win32::keybd_event(${vkCode}, 0, 2, 0)
`;

    // Encode as base64 to avoid quote escaping hell in command line
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const command = `powershell -WindowStyle Hidden -EncodedCommand ${encoded}`;

    exec(command, (error) => {
        if (error) {
            console.error('Media Key Error:', error);
        }
    });
};

// VK_MEDIA_NEXT_TRACK = 0xB0 (176)
// VK_MEDIA_PREV_TRACK = 0xB1 (177)
// VK_MEDIA_PLAY_PAUSE = 0xB3 (179)

module.exports = {
    playPause: () => sendKey(179),
    nextTrack: () => sendKey(176),
    prevTrack: () => sendKey(177)
};
