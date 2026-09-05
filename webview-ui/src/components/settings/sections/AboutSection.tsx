import { ExportRuntimeTelemetryBundleRequest } from "@shared/proto/index.dline"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

/**
 * What the last export attempt produced.
 *
 * The outcome is kept locally rather than in extension state because it
 * describes one user action, not a setting: it should disappear when the
 * settings view is closed, and nothing else in the app reacts to it.
 */
type ExportOutcome = { kind: "written"; path: string; sizeBytes: number } | { kind: "failed"; message: string }

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The consent that governs everything Dline records about a session.
 *
 * It lives beside the export button rather than in General settings because
 * the two describe one decision: the bundle only contains data this switch
 * allowed to be collected, and a user who turns the switch off should see the
 * export stop working right here instead of hunting for the cause elsewhere.
 */
function ReportingConsent() {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()

	return (
		<div>
			<h3 className="text-md font-semibold">Error and usage reporting</h3>
			<Tooltip>
				<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
				<TooltipTrigger asChild>
					<div className="flex items-center gap-2 mt-2">
						<VSCodeCheckbox
							checked={telemetrySetting !== "disabled"}
							data-testid="telemetry-setting-checkbox"
							disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
							}}>
							Allow error and usage reporting
						</VSCodeCheckbox>
						{!!remoteConfigSettings?.telemetrySetting && (
							<i className="codicon codicon-lock text-description text-sm" />
						)}
					</div>
				</TooltipTrigger>
			</Tooltip>

			<p className="text-sm mt-[5px] text-description">
				Help improve Dline by sending usage data and error reports, and let Dline record the runtime events a diagnostic
				bundle is built from. No code, prompts, or personal information are ever sent. See our{" "}
				<VSCodeLink
					className="text-inherit"
					href="https://docs.dline.bot/more-info/telemetry"
					style={{ fontSize: "inherit", textDecoration: "underline" }}>
					telemetry overview
				</VSCodeLink>{" "}
				and{" "}
				<VSCodeLink
					className="text-inherit"
					href="https://cline.bot/privacy"
					style={{ fontSize: "inherit", textDecoration: "underline" }}>
					privacy policy
				</VSCodeLink>{" "}
				for more details.
			</p>
		</div>
	)
}

/**
 * Writes the current session's diagnostic bundle into the Dline data directory.
 *
 * This sits next to the issue links because that is when it is needed: the
 * archive exists to be attached to a bug report, not to configure anything.
 *
 * The button stays enabled while telemetry is off: the extension host answers
 * with a specific reason in that case, and showing that reason is more useful
 * than a disabled control the user cannot interrogate.
 */
function DiagnosticBundleExport() {
	const [isExporting, setIsExporting] = useState(false)
	const [outcome, setOutcome] = useState<ExportOutcome | null>(null)

	const onExport = async () => {
		setIsExporting(true)
		setOutcome(null)
		try {
			const response = await StateServiceClient.exportRuntimeTelemetryBundle(ExportRuntimeTelemetryBundleRequest.create({}))
			if (response.error) {
				setOutcome({ kind: "failed", message: response.error })
				return
			}
			setOutcome({ kind: "written", path: response.path, sizeBytes: Number(response.sizeBytes) })
		} catch (error) {
			setOutcome({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
		} finally {
			setIsExporting(false)
		}
	}

	return (
		<div>
			<h3 className="text-md font-semibold">Diagnostics</h3>
			<p>
				Saves this session's runtime events, health snapshots, and root-cause analysis to a zip file under the Dline data
				directory, which you can attach to a bug report. Prompts, file contents, and credentials are excluded.
			</p>
			<VSCodeButton className="rounded-xs mt-2" disabled={isExporting} onClick={onExport}>
				{isExporting ? "Exporting…" : "Export diagnostic bundle"}
			</VSCodeButton>
			{outcome?.kind === "written" && (
				<p className="text-sm mt-[5px] text-description" data-testid="diagnostic-bundle-written">
					Saved to {outcome.path} ({formatBytes(outcome.sizeBytes)}).
				</p>
			)}
			{outcome?.kind === "failed" && (
				<p className="text-sm mt-[5px] text-error" data-testid="diagnostic-bundle-error">
					{outcome.message}
				</p>
			)}
		</div>
	)
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">Dline v{version}</h2>
					<p>
						An AI assistant that can use your CLI and Editor. Dline can handle complex software development tasks
						step-by-step with tools that let him create & edit files, explore large projects, use the browser, and
						execute terminal commands (after you grant permission).
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/TuvokYang/dline">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/TuvokYang/dline/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/TuvokYang/dline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							Feature Requests
						</VSCodeLink>
					</p>

					<ReportingConsent />
					<DiagnosticBundleExport />
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
