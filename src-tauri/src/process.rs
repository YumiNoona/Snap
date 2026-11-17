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
    if !["ffmpeg", "ffprobe", "yt-dlp", "node"]
        .iter()
        .any(|tool| name.eq_ignore_ascii_case(tool))
    {
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

pub(crate) fn media_tool_path(name: &str) -> Option<std::path::PathBuf> {
    resolve_media_tool(OsStr::new(name)).or_else(|| {
        let executable = format!("{name}.exe");
        std::env::var_os("PATH").and_then(|paths| {
            std::env::split_paths(&paths)
                .filter(|directory| directory.is_absolute())
                .map(|directory| directory.join(&executable))
                .find(|candidate| candidate.is_file())
        })
    })
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;

#[cfg(target_os = "windows")]
fn create_process_job() -> std::io::Result<windows::Win32::Foundation::HANDLE> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(std::io::Error::other)?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(error) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&limits) as u32,
        ) {
            let _ = CloseHandle(job);
            return Err(std::io::Error::other(error));
        }
        Ok(job)
    }
}

#[cfg(target_os = "windows")]
fn recording_job_handle() -> std::io::Result<windows::Win32::Foundation::HANDLE> {
    use windows::Win32::Foundation::HANDLE;
    // Windows closes this handle on Snap exit and stops every capture encoder.
    static JOB: OnceLock<Result<usize, String>> = OnceLock::new();
    let raw = JOB.get_or_init(|| {
        create_process_job()
            .map(|job| job.0 as usize)
            .map_err(|error| error.to_string())
    });
    match raw {
        Ok(value) => Ok(HANDLE(*value as *mut std::ffi::c_void)),
        Err(message) => Err(std::io::Error::other(message.clone())),
    }
}

#[cfg(target_os = "windows")]
pub(crate) struct ProcessJob(windows::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
impl ProcessJob {
    pub(crate) fn new() -> std::io::Result<Self> {
        create_process_job().map(Self)
    }

    pub(crate) fn spawn(&self, command: &mut Command) -> std::io::Result<Child> {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;

        let mut child = command.spawn()?;
        if let Err(error) =
            unsafe { AssignProcessToJobObject(self.0, HANDLE(child.as_raw_handle())) }
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other(error));
        }
        Ok(child)
    }
}

#[cfg(target_os = "windows")]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
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
    let resolved = requested
        .to_str()
        .filter(|name| name.eq_ignore_ascii_case("ffmpeg") || name.eq_ignore_ascii_case("ffprobe"))
        .and_then(media_tool_path);
    let mut command = match resolved {
        Some(path) => Command::new(path),
        None if requested.eq_ignore_ascii_case(OsStr::new("ffmpeg"))
            || requested.eq_ignore_ascii_case(OsStr::new("ffprobe")) =>
        {
            let executable = format!("{}.exe", requested.to_string_lossy());
            // Never let Windows search the working directory for media tools.
            Command::new(std::path::PathBuf::from(r"C:\Program Files\Snap\tools").join(executable))
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
