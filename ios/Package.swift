// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Ledgerbay",
    platforms: [
        .iOS(.v16),
    ],
    products: [
        .library(
            name: "Ledgerbay",
            targets: ["Ledgerbay"]
        ),
    ],
    targets: [
        .target(
            name: "Ledgerbay",
            resources: [
                .copy("Web"),
                .copy("shell.js"),
            ],
            // Swift 5 mode keeps WKWebView delegate signatures building across
            // the Xcode versions xtool supports. The app still deploys to iOS 16.
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]
        ),
    ]
)
