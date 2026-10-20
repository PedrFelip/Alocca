
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "br.com.alocca.plantoes"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.alocca.plantoes"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        val apiBaseUrl = providers.gradleProperty("AloccaApiBaseUrl")
            .orElse(providers.environmentVariable("ALOCCA_API_BASE_URL"))
            .getOrElse("http://10.0.2.2:3000/")
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl.trimEnd('/')}/\"")
    }

    // Configura Java e Kotlin para a mesma versão
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
