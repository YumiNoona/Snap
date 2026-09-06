use std::ffi::OsStr;
use std::process::{Child, Command};
use std::sync::OnceLock;

/// Routine capture tracing is opt-in so normal and development recordings do
/// not spam a terminal or pay for repeated console writes. Support traces can
/// be enabled explicitly with `SNAP_DIAGNOSTICS=1`.
pub(crate) fn recording_diagnostic(message: std::fmt::Arguments<'_>) {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if *ENABLED.get_or_init(|| {
        std::env::var("SNAP_DIAGNOSTICS")
            .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
    }) {
        eprintln!("{message}");
    }
}

fn resolve_media_tool(requested: &OsStr) -> Option<std::path::PathBuf> {
    let name = requested.to_string_lossy();
    if !name.eq_ignore_ascii_case("ffmpeg") && !name.eq_ignore_ascii_case("ffprobe") {
        return None;
    }
    let executable = format!("{name}.exe");
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let local = std::path::PathBuf::from(local);
    for candidate in [
        local.join("Snap").join("tools").join(&executable),
        local
            .join("Microsoft")
            .join("WinGet")
            .join("Links")
            .join(&executable),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let packages = local.join("Microsoft").join("WinGet").join("Packages");
    for package in std::fs::read_dir(packages).ok()?.flatten() {
        if !package
            .file_name()
            .to_string_lossy()
            .starts_with("Gyan.FFmpeg")
        {
            continue;
        }
        for build in std::fs::read_dir(package.path()).ok()?.flatten() {
            let candidate = build.path().join("bin").join(&executable);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;

#[cfg(target_os = "windows")]
fn recording_job_handle() -> std::io::Result<windows::Win32::Foundation::HANDLE> {
    use std::io::Error;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The process owns this handle for its entire lifetime. Closing it during
    // app shutdown (including a crash or forced close) makes Windows terminate
    // every live capture encoder assigned to the job.
    static JOB: OnceLock<Result<usize, String>> = OnceLock::new();
    let raw = JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|error| error.to_string())?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&limits) as u32,
        )
        .map_err(|error| error.to_string())?;
        Ok(job.0 as usize)
    });
    match raw {
        Ok(value) => Ok(HANDLE(*value as *mut std::ffi::c_void)),
        Err(message) => Err(Error::other(message.clone())),
    }
}

/// Starts a long-lived capture subprocess and attaches it to Snap's Windows
/// job object. A recorder crash can therefore never leave FFmpeg consuming
/// the GPU in the background indefinitely.
pub(crate) fn spawn_recording_child(command: &mut Command) -> std::io::Result<Child> {
    let mut child = command.spawn()?;

    #[cfg(target_os = "windows")]
    {
        use std::io::Error;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;

        let result = recording_job_handle().and_then(|job| unsafe {
            let process = HANDLE(child.as_raw_handle());
            AssignProcessToJobObject(job, process).map_err(|error| Error::other(error.to_string()))
        });
        if let Err(error) = result {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::other(format!(
                "Unable to protect the recording process from becoming orphaned: {error}"
            )));
        }
    }

    Ok(child)
}

/// Creates a subprocess that never allocates a visible console window.
///
/// Snap is a GUI application, but FFmpeg and small Windows utilities are
/// console applications. Without `CREATE_NO_WINDOW`, Windows can open a blank
/// terminal whenever one of those tools is launched from the installed app.
pub(crate) fn background_command<S: AsRef<OsStr>>(program: S) -> Command {
    let requested = program.as_ref();
    let resolved = resolve_media_tool(requested);
    let mut command = match resolved {
        Some(path) => Command::new(path),
        None if requested.eq_ignore_ascii_case(OsStr::new("ffmpeg"))
            || requested.eq_ignore_ascii_case(OsStr::new("ffprobe")) =>
        {
            let executable = format!("{}.exe", requested.to_string_lossy());
            let from_path = std::env::var_os("PATH").and_then(|paths| {
                std::env::split_paths(&paths)
                    .filter(|directory| directory.is_absolute())
                    .map(|directory| directory.join(&executable))
                    .find(|candidate| candidate.is_file())
            });
            // Never let Windows search the working directory for media tools.
            Command::new(from_path.unwrap_or_else(|| {
                std::path::PathBuf::from(r"C:\Program Files\Snap\tools").join(executable)
            }))
        }
        None => Command::new(requested),
    };

    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    command
}

/// Creates a hidden, below-normal-priority process for latency-sensitive media
/// work. User-initiated export keeps normal priority, while capture and its
/// immediate recovery/finalization pass must yield to interactive apps.
pub(crate) fn recording_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = background_command(program);

    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000 | 0x0000_4000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS

    command
}
