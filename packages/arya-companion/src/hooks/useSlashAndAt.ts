import type { AgentInfo, CommandInfo } from "@/lib/ws";

/**
 * Derive the inline `/command` and `@agent` popovers from the current
 * input. The popovers only open while the prefix is the first character
 * and no space has been typed yet — once the user starts arguments we
 * get out of the way.
 */
export function useSlashAndAt(
	input: string,
	commands: CommandInfo[],
	agents: AgentInfo[],
) {
	const showCommandMenu = input.startsWith("/") && !input.includes(" ");
	const commandQuery = input.slice(1).toLowerCase();

	const filteredCommands = showCommandMenu
		? commands.filter((c) => {
				if (!commandQuery) return true;
				return (
					c.command.toLowerCase().includes(commandQuery) ||
					c.description.toLowerCase().includes(commandQuery)
				);
			})
		: [];

	const showAgentMenu = input.startsWith("@") && !input.includes(" ");
	const agentQuery = input.slice(1).toLowerCase();

	// Only subagents are dispatchable via `@<name>` — the server's
	// mu-agents `transformUserInput` hook intercepts mentions of registered
	// subagents and runs them. Mentioning a primary agent would just become
	// literal text, so we hide them from the inline menu.
	const filteredAgents = showAgentMenu
		? agents
				.filter((a) => (a.type ?? "primary") === "subagent")
				.filter((a) => {
					if (!agentQuery) return true;
					return (
						a.id.toLowerCase().includes(agentQuery) ||
						a.description.toLowerCase().includes(agentQuery)
					);
				})
		: [];

	return {
		showCommandMenu,
		filteredCommands,
		showAgentMenu,
		filteredAgents,
	};
}
