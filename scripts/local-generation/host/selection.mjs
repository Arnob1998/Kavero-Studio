// Research access and approval to redistribute a package are separate policies.
export function modelSelectionMode(config) {
  return config.userSelectedModels === true ? 'user-selected' : config.internalEvaluation === true ? 'internal-evaluation' : 'disabled';
}
export const evaluationEnabled = config => modelSelectionMode(config) !== 'disabled';
