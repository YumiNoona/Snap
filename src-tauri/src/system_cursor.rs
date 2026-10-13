//! Editor-only snapshot of the user's Windows Normal Select pointer.
//! LoadCursorW returns the shared system arrow; never destroy or replace it.
//! GetIconInfo's copied bitmaps and our memory DC/DIB are owned and released here.
use serde::Serialize;
use std::ffi::c_void;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetObjectW,
    SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, GetIconInfo, LoadCursorW, DI_NORMAL, HICON, ICONINFO, IDC_ARROW,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCursor {
    width: u32,
    height: u32,
    hotspot_x: u32,
    hotspot_y: u32,
    png: Vec<u8>,
    invert_png: Option<Vec<u8>>,
}

struct IconBitmaps(ICONINFO);
impl Drop for IconBitmaps {
    fn drop(&mut self) {
        unsafe {
            if !self.0.hbmColor.is_invalid() {
                let _ = DeleteObject(self.0.hbmColor.into());
            }
            if !self.0.hbmMask.is_invalid() {
                let _ = DeleteObject(self.0.hbmMask.into());
            }
        }
    }
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: *mut u8,
    width: u32,
    height: u32,
}
impl Surface {
    fn new(width: u32, height: u32) -> Result<Self, String> {
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return Err("Could not create cursor memory DC".into());
            }
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            {
                Ok(bitmap) => bitmap,
                Err(error) => {
                    let _ = DeleteDC(dc);
                    return Err(error.to_string());
                }
            };
            if bits.is_null() {
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(dc);
                return Err("Cursor bitmap has no pixels".into());
            }
            let previous = SelectObject(dc, bitmap.into());
            if previous.is_invalid() || previous.0 as isize == -1 {
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(dc);
                return Err("Could not select cursor bitmap".into());
            }
            Ok(Self {
                dc,
                bitmap,
                previous,
                bits: bits.cast(),
                width,
                height,
            })
        }
    }
    fn render(&mut self, cursor: HICON, background: u8) -> Result<Vec<u8>, String> {
        unsafe {
            let length = (self.width * self.height * 4) as usize;
            {
                let pixels = std::slice::from_raw_parts_mut(self.bits, length);
                for pixel in pixels.chunks_exact_mut(4) {
                    pixel.copy_from_slice(&[background, background, background, 255]);
                }
            }
            DrawIconEx(
                self.dc,
                0,
                0,
                cursor,
                self.width as i32,
                self.height as i32,
                0,
                None,
                DI_NORMAL,
            )
            .map_err(|error| error.to_string())?;
            if !GdiFlush().as_bool() {
                return Err("Could not flush cursor drawing".into());
            }
            Ok(std::slice::from_raw_parts(self.bits, length).to_vec())
        }
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            let _ = SelectObject(self.dc, self.previous);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

// Windows applies either alpha blending or legacy AND/XOR masks (DrawIconEx).
// Rendering on black AND white recovers straight alpha without black rectangles,
// and identifies the inverted pixels that must invert the real video background.
fn recover_pixels(black: &[u8], white: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut rgba = vec![0; black.len()];
    let mut inverse = vec![0; black.len()];
    for (((dark, light), output), invert) in black
        .chunks_exact(4)
        .zip(white.chunks_exact(4))
        .zip(rgba.chunks_exact_mut(4))
        .zip(inverse.chunks_exact_mut(4))
    {
        if dark[..3] == [255, 255, 255] && light[..3] == [0, 0, 0] {
            invert.copy_from_slice(&[255, 255, 255, 255]);
            continue;
        }
        let transparency = (0..3)
            .map(|channel| light[channel].saturating_sub(dark[channel]))
            .max()
            .unwrap_or(255);
        let alpha = 255 - transparency;
        if alpha == 0 {
            continue;
        }
        for (channel, bgra) in [2, 1, 0].into_iter().enumerate() {
            output[channel] =
                ((dark[bgra] as u32 * 255 + alpha as u32 / 2) / alpha as u32).min(255) as u8;
        }
        output[3] = alpha;
    }
    (rgba, inverse)
}

fn png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(rgba)
            .map_err(|error| error.to_string())?;
    }
    Ok(bytes)
}

fn pack_cursor(
    width: u32,
    height: u32,
    hotspot_x: u32,
    hotspot_y: u32,
    rgba: &[u8],
    inverse: &[u8],
) -> Result<SystemCursor, String> {
    // Remove the native bitmap's unused transparent margin. Include the hotspot
    // so left-handed/asymmetric pointers still land exactly on the recorded point.
    let mut left = hotspot_x.min(width - 1);
    let mut right = left;
    let mut top = hotspot_y.min(height - 1);
    let mut bottom = top;
    let mut visible = false;
    let mut has_inverse = false;
    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            if rgba[i + 3] == 0 && inverse[i + 3] == 0 {
                continue;
            }
            visible = true;
            has_inverse |= inverse[i + 3] != 0;
            left = left.min(x);
            right = right.max(x);
            top = top.min(y);
            bottom = bottom.max(y);
        }
    }
    if !visible {
        return Err("Windows returned an empty pointer image".into());
    }
    let cropped_width = right - left + 1;
    let cropped_height = bottom - top + 1;
    let crop = |source: &[u8]| {
        let mut pixels = Vec::with_capacity((cropped_width * cropped_height * 4) as usize);
        for y in top..=bottom {
            let start = ((y * width + left) * 4) as usize;
            pixels.extend_from_slice(&source[start..start + (cropped_width * 4) as usize]);
        }
        pixels
    };
    Ok(SystemCursor {
        width: cropped_width,
        height: cropped_height,
        hotspot_x: hotspot_x.min(width - 1) - left,
        hotspot_y: hotspot_y.min(height - 1) - top,
        png: png(cropped_width, cropped_height, &crop(rgba))?,
        invert_png: if has_inverse {
            Some(png(cropped_width, cropped_height, &crop(inverse))?)
        } else {
            None
        },
    })
}

fn snapshot() -> Result<SystemCursor, String> {
    unsafe {
        let cursor = LoadCursorW(None, IDC_ARROW).map_err(|error| error.to_string())?;
        let icon = HICON(cursor.0);
        let mut info = IconBitmaps(ICONINFO::default());
        GetIconInfo(icon, &mut info.0).map_err(|error| error.to_string())?;
        let monochrome = info.0.hbmColor.is_invalid();
        let bitmap = if monochrome {
            info.0.hbmMask
        } else {
            info.0.hbmColor
        };
        let mut dimensions = BITMAP::default();
        if GetObjectW(
            bitmap.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut dimensions as *mut BITMAP).cast()),
        ) == 0
        {
            return Err("Could not read Windows pointer dimensions".into());
        }
        let width = dimensions.bmWidth.unsigned_abs();
        let height = dimensions.bmHeight.unsigned_abs() / if monochrome { 2 } else { 1 };
        if width == 0 || height == 0 || width > 512 || height > 512 {
            return Err("Unsupported Windows pointer dimensions".into());
        }
        let mut surface = Surface::new(width, height)?;
        let black = surface.render(icon, 0)?;
        let white = surface.render(icon, 255)?;
        let (rgba, inverse) = recover_pixels(&black, &white);
        pack_cursor(
            width,
            height,
            info.0.xHotspot,
            info.0.yHotspot,
            &rgba,
            &inverse,
        )
    }
}

#[tauri::command]
pub async fn get_system_cursor() -> Result<SystemCursor, String> {
    tauri::async_runtime::spawn_blocking(snapshot)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovers_transparency_color_and_legacy_inversion() {
        let black = [
            0, 0, 0, 255, 30, 60, 90, 255, 25, 50, 75, 255, 255, 255, 255, 255,
        ];
        let white = [
            255, 255, 255, 255, 30, 60, 90, 255, 152, 177, 202, 255, 0, 0, 0, 255,
        ];
        let (rgba, inverse) = recover_pixels(&black, &white);
        assert_eq!(&rgba[..4], &[0, 0, 0, 0]);
        assert_eq!(&rgba[4..8], &[90, 60, 30, 255]);
        assert_eq!(&rgba[8..12], &[149, 100, 50, 128]);
        assert_eq!(&rgba[12..], &[0, 0, 0, 0]);
        assert_eq!(&inverse[12..], &[255, 255, 255, 255]);
    }
    #[test]
    fn removes_transparent_padding_without_losing_the_hotspot_or_invert_mask() {
        let mut rgba = vec![0; 4 * 4 * 4];
        let mut inverse = rgba.clone();
        rgba[24..28].copy_from_slice(&[50, 100, 200, 255]);
        inverse[40..44].copy_from_slice(&[255; 4]);
        let cursor = pack_cursor(4, 4, 3, 1, &rgba, &inverse).unwrap();
        assert_eq!(
            (
                cursor.width,
                cursor.height,
                cursor.hotspot_x,
                cursor.hotspot_y
            ),
            (2, 2, 1, 0)
        );
        assert!(cursor.invert_png.is_some());
        assert!(pack_cursor(4, 4, 0, 0, &[0; 64], &[0; 64]).is_err());
    }
    #[test]
    fn exports_the_current_windows_normal_pointer() {
        let cursor = snapshot().unwrap();
        assert!(cursor.width > 0 && cursor.height > 0);
        assert!(cursor.hotspot_x < cursor.width && cursor.hotspot_y < cursor.height);
        if let Ok(path) = std::env::var("SNAP_SYSTEM_CURSOR_FIXTURE") {
            std::fs::write(path, serde_json::to_vec(&cursor).unwrap()).unwrap();
        }
        let decoder = png::Decoder::new(std::io::Cursor::new(cursor.png));
        let reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().width, cursor.width);
        assert_eq!(reader.info().height, cursor.height);
    }
}
