// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--uninstall-cleanup") {
        if let Err(error) = streamdash_lib::uninstall_cleanup() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    streamdash_lib::run();
}
