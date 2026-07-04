import type { Mode } from "@shared/storage/types"
import { CheckIcon, EditIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import type { ApiProfile } from "./ProviderProfile"
import ApiProfileCard from "./ProviderProfileCard"

interface ApiProfileListProps {
	profiles: ApiProfile[]
	expandedId: string | null
	editMode: boolean
	currentMode: Mode
	providerOptions: { value: string; label: string }[]
	onToggleExpand: (id: string) => void
	onToggleEditMode: () => void
	onAddProfile: () => void
	onDeleteProfile: (id: string) => void
	onUpdateProfile: (id: string, updates: Partial<ApiProfile>) => void
}

const btnClass =
	"flex items-center justify-center gap-1 py-2 rounded border border-input-border hover:bg-input-background/30 text-description hover:text-foreground transition-colors cursor-pointer bg-transparent"

/**
 * List of configured provider profiles with edit mode, multi-select, and add/delete.
 */
const ApiProfileList: React.FC<ApiProfileListProps> = ({
	profiles,
	expandedId,
	editMode,
	currentMode,
	providerOptions,
	onToggleExpand,
	onToggleEditMode,
	onAddProfile,
	onDeleteProfile,
	onUpdateProfile,
}) => {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [confirmDelete, setConfirmDelete] = useState(false)

	const toggleSelect = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const handleDeleteClick = () => {
		if (!confirmDelete) {
			setConfirmDelete(true)
			setTimeout(() => setConfirmDelete(false), 5000)
			return
		}
		selectedIds.forEach((id) => onDeleteProfile(id))
		setSelectedIds(new Set())
		setConfirmDelete(false)
	}

	return (
		<div className="mb-4">
			{/* Header */}
			<div className="flex items-center justify-between mb-2">
				<span className="text-sm font-semibold" style={{ color: "var(--vscode-foreground)" }}>
					API Configuration
				</span>
				<button className={`${btnClass} px-3 text-xs`} onClick={onToggleEditMode} type="button">
					{editMode ? <CheckIcon size={14} /> : <EditIcon size={14} />}
					<span>{editMode ? "Done" : "Edit"}</span>
				</button>
			</div>

			{/* Profile cards */}
			{profiles.map((profile) => (
				<ApiProfileCard
					currentMode={currentMode}
					editMode={editMode}
					isExpanded={expandedId === profile.id}
					key={profile.id}
					onDelete={() => onDeleteProfile(profile.id)}
					onToggleExpand={() => onToggleExpand(profile.id)}
					onToggleSelect={() => toggleSelect(profile.id)}
					onUpdate={(updates) => onUpdateProfile(profile.id, updates)}
					profile={profile}
					providerOptions={providerOptions}
					selected={selectedIds.has(profile.id)}
				/>
			))}

			{/* Bottom bar */}
			<div className="flex items-center gap-2 mt-2">
				<button className={`${btnClass} flex-1 text-sm`} onClick={onAddProfile} type="button">
					<PlusIcon size={16} />
					<span>Add API</span>
				</button>
				{editMode && (
					<button
						className={`flex-1 flex items-center justify-center gap-1 py-2 rounded border transition-colors cursor-pointer text-sm ${
							confirmDelete
								? "bg-red-600 text-white border-red-600"
								: selectedIds.size > 0
									? btnClass
									: `${btnClass} opacity-40 cursor-not-allowed`
						}`}
						disabled={!confirmDelete && selectedIds.size === 0}
						onClick={handleDeleteClick}
						type="button">
						<Trash2Icon size={16} />
						<span>{confirmDelete ? `Confirm (${selectedIds.size})` : `Delete (${selectedIds.size})`}</span>
					</button>
				)}
			</div>

			{profiles.length === 0 && (
				<div className="text-xs text-muted-foreground text-center mt-2">
					No APIs configured yet. Click "Add API" above.
				</div>
			)}
		</div>
	)
}

export default ApiProfileList
