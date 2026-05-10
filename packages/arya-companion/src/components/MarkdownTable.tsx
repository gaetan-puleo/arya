import { Text, View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";

export interface MarkdownTableData {
	headers: string[];
	alignments: ("left" | "center" | "right")[];
	rows: string[][];
}

interface MarkdownTableProps {
	table: MarkdownTableData;
	textColor: string;
	fontSize?: number;
}

/**
 * Render a parsed markdown table as a native View grid.
 *
 * Rendering inline markdown inside cells is intentionally NOT supported here
 * to keep the layout predictable on small screens. Cells render as plain
 * text. If you need rich cell content later, lift the inline parser into a
 * cell renderer.
 */
export default function MarkdownTable({
	table,
	textColor,
	fontSize = 14,
}: MarkdownTableProps) {
	const { theme } = useUnistyles();
	const borderColor = theme.colors.border;
	const headerBg = theme.colors.backgroundTertiary;
	const altRowBg = theme.colors.backgroundHover;

	const colCount = Math.max(
		table.headers.length,
		...table.rows.map((r) => r.length),
	);

	const alignFor = (i: number): "left" | "center" | "right" =>
		table.alignments[i] ?? "left";

	const Cell = ({
		text,
		bold,
		align,
		isLastCol,
		isLastRow,
		bg,
	}: {
		text: string;
		bold?: boolean;
		align: "left" | "center" | "right";
		isLastCol: boolean;
		isLastRow: boolean;
		bg?: string;
	}) => (
		<View
			style={{
				flex: 1,
				paddingHorizontal: 12,
				paddingVertical: 8,
				borderRightWidth: isLastCol ? 0 : 1,
				borderBottomWidth: isLastRow ? 0 : 1,
				borderColor,
				backgroundColor: bg,
				justifyContent: "center",
			}}
		>
			<Text
				style={{
					fontSize,
					color: textColor,
					fontWeight: bold ? "700" : "400",
					textAlign: align,
					lineHeight: fontSize + 4,
				}}
			>
				{text}
			</Text>
		</View>
	);

	return (
		<View
			style={{
				borderWidth: 1,
				borderColor,
				borderRadius: 8,
				overflow: "hidden",
				marginVertical: 4,
			}}
		>
			{/* Header row */}
			<View style={{ flexDirection: "row" }}>
				{Array.from({ length: colCount }).map((_, i) => (
					<Cell
						key={`h-${i}`}
						text={table.headers[i] ?? ""}
						bold
						align={alignFor(i)}
						isLastCol={i === colCount - 1}
						isLastRow={table.rows.length === 0}
						bg={headerBg}
					/>
				))}
			</View>

			{/* Body rows */}
			{table.rows.map((row, ri) => {
				const isLastRow = ri === table.rows.length - 1;
				const bg = ri % 2 === 1 ? altRowBg : undefined;
				return (
					<View key={`r-${ri}`} style={{ flexDirection: "row" }}>
						{Array.from({ length: colCount }).map((_, ci) => (
							<Cell
								key={`r-${ri}-c-${ci}`}
								text={row[ci] ?? ""}
								align={alignFor(ci)}
								isLastCol={ci === colCount - 1}
								isLastRow={isLastRow}
								bg={bg}
							/>
						))}
					</View>
				);
			})}
		</View>
	);
}
