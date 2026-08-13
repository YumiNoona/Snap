use std::ffi::OsStr;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Creates a subprocess that never allocates a visible console window.
///
/// Snap is a GUI application, but FFmpeg and small Windows utilities are
/// console applications. Without `CREATE_NO_WINDOW`, Windows can open a blank
/// terminal whenever one of those tools is launched from the installed app.
pub(crate) fn background_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);

    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    command
}
