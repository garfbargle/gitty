import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "app.gitty.desktop"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.gitty.desktop"
        // The bundled git is built against API 28 (getrandom, sync_file_range).
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                // Tauri's default keeps symbols for every .so, which leaves the
                // debug Rust library at ~170 MB. Strip them; the only file that
                // must be kept is git-subtree, which is a shell script and not
                // a valid object file for the stripper.
                jniLibs.keepDebugSymbols.add("*/*/libgit-subtree.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            packaging {
                // git-subtree is a shell script that only happens to be named
                // lib*.so, so it is not something the symbol stripper can read.
                // AGP only warns and packages it unchanged, but saying so here
                // keeps that from being an accident.
                jniLibs.keepDebugSymbols.add("*/*/libgit-subtree.so")
            }
        }
    }
    // The bundled git ships as lib*.so under jniLibs. Android only permits
    // exec from nativeLibraryDir, and the files are only written there when
    // legacy (uncompressed-on-install) packaging is used -- without this AGP
    // leaves them inside the APK and nothing is extracted to disk.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    // ViewCompat/WindowInsetsCompat, which MainActivity uses to read the window
    // insets. It arrives transitively through appcompat too, but the version
    // that resolves to is not this module's to depend on by accident.
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")