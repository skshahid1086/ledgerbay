import CryptoKit
import UIKit
import WebKit

/// Offline shell around the bundled Ledgerbay web app.
///
/// Web files are copied into Application Support so the `file://` origin stays
/// the same across launches and app updates (the bundle path changes on update).
/// localStorage and IndexedDB live in `WKWebsiteDataStore.default()`, which
/// iOS keeps in the app container until the app is deleted.
final class LedgerbayViewController: UIViewController {
    private var webView: WKWebView!
    private var lastInsets = UIEdgeInsets(top: -1, left: 0, bottom: 0, right: 0)
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        overrideUserInterfaceStyle = .light
        edgesForExtendedLayout = .all
        extendedLayoutIncludesOpaqueBars = true

        do {
            let root = try installWebRoot()
            let index = root.appendingPathComponent("index.html")
            guard FileManager.default.fileExists(atPath: index.path) else {
                throw ShellError.message("The Ledgerbay web build is missing index.html. Run scripts/build-ios.sh.")
            }
            installWebView()
            webView.loadFileURL(index, allowingReadAccessTo: root)
        } catch {
            showBlockingMessage(error.localizedDescription)
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applySafeArea()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        applySafeArea()
    }

    private func installWebView() {
        let contentController = WKUserContentController()
        contentController.add(self, name: "ledgerbay")
        if let scriptURL = Bundle.module.url(forResource: "shell", withExtension: "js"),
           let source = try? String(contentsOf: scriptURL, encoding: .utf8) {
            let script = WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            contentController.addUserScript(script)
        }

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: view.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        self.webView = webView
        cleanOldExports()
    }

    private func applySafeArea() {
        guard webView != nil else { return }
        let insets = view.safeAreaInsets
        guard insets != lastInsets else { return }
        lastInsets = insets
        let js = "window.__ledgerbaySetSafeArea && window.__ledgerbaySetSafeArea(\(insets.top), \(insets.right), \(insets.bottom), \(insets.left));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func showBlockingMessage(_ text: String) {
        let label = UILabel()
        label.text = text
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.059, green: 0.090, blue: 0.165, alpha: 1)
        label.font = .preferredFont(forTextStyle: .body)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -8),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    // MARK: - Stable web origin

    private func bundledWebRoot() throws -> URL {
        guard let resource = Bundle.module.resourceURL else {
            throw ShellError.message("The app bundle has no resource directory.")
        }
        let root = resource.appendingPathComponent("Web", isDirectory: true)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir), isDir.boolValue else {
            throw ShellError.message("Web resources were not packaged. Run scripts/build-ios.sh before xtool.")
        }
        return root
    }

    /// Copy bundled files to a path that does not change when iOS updates the app.
    private func installWebRoot() throws -> URL {
        let source = try bundledWebRoot()
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dest = support.appendingPathComponent("LedgerbayWeb", isDirectory: true)
        let stampURL = support.appendingPathComponent("LedgerbayWeb.stamp")
        let stamp = try fingerprint(of: source)
        if FileManager.default.fileExists(atPath: dest.appendingPathComponent("index.html").path),
           (try? String(contentsOf: stampURL, encoding: .utf8)) == stamp {
            return dest
        }
        let incoming = support.appendingPathComponent("LedgerbayWeb.incoming", isDirectory: true)
        if FileManager.default.fileExists(atPath: incoming.path) {
            try FileManager.default.removeItem(at: incoming)
        }
        try FileManager.default.copyItem(at: source, to: incoming)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.moveItem(at: incoming, to: dest)
        try stamp.write(to: stampURL, atomically: true, encoding: .utf8)
        return dest
    }

    /// Content hash, so a same-size web update still replaces the staged files.
    private func fingerprint(of root: URL) throws -> String {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey]
        ) else {
            throw ShellError.message("Could not read the bundled web files.")
        }
        var files: [URL] = []
        while let item = enumerator.nextObject() as? URL {
            let values = try item.resourceValues(forKeys: [.isRegularFileKey])
            if values.isRegularFile == true { files.append(item) }
        }
        files.sort { $0.path < $1.path }
        var hasher = SHA256()
        for item in files {
            let relative = item.path.hasPrefix(root.path) ? String(item.path.dropFirst(root.path.count)) : item.lastPathComponent
            hasher.update(data: Data(relative.utf8))
            hasher.update(data: Data(contentsOf: item))
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Share sheet and print

    private func exportsDirectory() -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("LedgerbayExports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func cleanOldExports() {
        let dir = exportsDirectory()
        let files = (try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey]
        )) ?? []
        let cutoff = Date().addingTimeInterval(-86_400)
        for file in files {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if modified < cutoff {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    private func presentShare(items: [Any]) {
        guard !items.isEmpty else { return }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let popover = controller.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        let present = { self.present(controller, animated: true) }
        if presentedViewController != nil {
            dismiss(animated: false, completion: present)
        } else {
            present()
        }
    }

    private func shareFile(base64: String, name: String, mime: String) {
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters), !data.isEmpty else {
            showAlert("Could not prepare that file for sharing.")
            return
        }
        let filename = filenameWithExtension(sanitizedFilename(name), mime: mime)
        let url = uniqueURL(in: exportsDirectory(), name: filename)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            showAlert("Could not save that file for sharing.")
            return
        }
        presentShare(items: [url])
    }

    private func presentPrint(jobName: String) {
        let run = { [weak self] in
            guard let self, let webView = self.webView else { return }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo.printInfo()
            info.outputType = .general
            info.jobName = jobName.isEmpty ? "Ledgerbay" : jobName
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, _, _ in
                webView.evaluateJavaScript(
                    "window.dispatchEvent(new Event('afterprint'))",
                    completionHandler: nil
                )
            }
        }
        if presentedViewController != nil {
            dismiss(animated: false, completion: run)
        } else {
            run()
        }
    }

    private func showAlert(_ message: String) {
        let alert = UIAlertController(title: "Ledgerbay", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        let present = { self.present(alert, animated: true) }
        if presentedViewController != nil {
            dismiss(animated: false, completion: present)
        } else {
            present()
        }
    }

    private var lastExternalOpen: (url: String, at: Date)?

    private func openExternal(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard ["http", "https", "tel", "mailto", "whatsapp"].contains(scheme) else { return }
        let key = url.absoluteString
        if let last = lastExternalOpen, last.url == key, Date().timeIntervalSince(last.at) < 1.0 {
            return
        }
        lastExternalOpen = (key, Date())
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func sanitizedFilename(_ raw: String) -> String {
        let base = (raw as NSString).lastPathComponent
        let cleanedScalars = base.unicodeScalars.filter { scalar in
            if scalar.value < 32 { return false }
            return scalar != "/" && scalar != "\\" && scalar != ":"
        }
        let name = String(String.UnicodeScalarView(cleanedScalars))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == "." || name == ".." { return "Ledgerbay" }
        return name
    }

    private func filenameWithExtension(_ name: String, mime: String) -> String {
        if !(name as NSString).pathExtension.isEmpty { return name }
        let ext: String
        switch mime.lowercased() {
        case "application/pdf": ext = "pdf"
        case "application/json", "text/json": ext = "json"
        case "text/csv": ext = "csv"
        case "text/plain": ext = "txt"
        case "image/png": ext = "png"
        case "image/jpeg": ext = "jpg"
        default: ext = ""
        }
        return ext.isEmpty ? name : "\(name).\(ext)"
    }

    private func uniqueURL(in directory: URL, name: String) -> URL {
        let first = directory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: first.path) { return first }
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        for index in 2...40 {
            let candidate = ext.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(ext)"
            let url = directory.appendingPathComponent(candidate)
            if !FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return directory.appendingPathComponent(UUID().uuidString + "-" + name)
    }

    private func remember(_ download: WKDownload, destination: URL) {
        downloadDestinations[ObjectIdentifier(download)] = destination
    }

    private func takeDestination(_ download: WKDownload) -> URL? {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

extension LedgerbayViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        let handle = { [weak self] in
            self?.handleBridge(body)
        }
        if Thread.isMainThread {
            handle()
        } else {
            DispatchQueue.main.async(execute: handle)
        }
    }

    private func handleBridge(_ body: Any) {
        guard let payload = body as? [String: Any], let type = payload["type"] as? String else { return }
        switch type {
        case "share-file":
            let base64 = payload["base64"] as? String ?? ""
            let name = payload["name"] as? String ?? "Ledgerbay"
            let mime = payload["mime"] as? String ?? "application/octet-stream"
            shareFile(base64: base64, name: name, mime: mime)
        case "share-text":
            let text = payload["text"] as? String ?? ""
            let title = payload["title"] as? String ?? ""
            let combined = title.isEmpty ? text : (text.isEmpty ? title : "\(title)\n\(text)")
            if !combined.isEmpty {
                presentShare(items: [combined])
            }
        case "print":
            let title = (payload["title"] as? String ?? "Ledgerbay")
            let job = title.count > 80 ? String(title.prefix(80)) : title
            presentPrint(jobName: job)
        default:
            break
        }
    }
}

extension LedgerbayViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "file" || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        let leavesApp = navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil
        if leavesApp && ["http", "https", "tel", "mailto", "whatsapp"].contains(scheme) {
            openExternal(url)
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame == true && (scheme == "http" || scheme == "https") {
            openExternal(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.download)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lastInsets = UIEdgeInsets(top: -1, left: 0, bottom: 0, right: 0)
        applySafeArea()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        showBlockingMessage("Ledgerbay could not open the local books. \(error.localizedDescription)")
    }
}

extension LedgerbayViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            openExternal(url)
        }
        return nil
    }
}

extension LedgerbayViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let suggested = response.suggestedFilename ?? suggestedFilename
        let name = filenameWithExtension(sanitizedFilename(suggested), mime: response.mimeType ?? "")
        let dest = uniqueURL(in: exportsDirectory(), name: name)
        remember(download, destination: dest)
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = takeDestination(download) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.presentShare(items: [url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = takeDestination(download) {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

private enum ShellError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}
