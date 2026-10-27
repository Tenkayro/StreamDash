fn main() {
    println!("cargo:rerun-if-env-changed=STREAMDASH_CHANNEL");
    tauri_build::build()
}
