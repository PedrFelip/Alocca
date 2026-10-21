buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // AGP 9.4 embute KGP 2.2.10; subimos para o Kotlin que suporta bytecode Java 25.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10")
    }
}

plugins {
    id("com.android.application") version "9.4.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}
