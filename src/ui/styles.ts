// Keep the cascade in one place. Supporting pages still use the legacy classes;
// workspace views and new components use the semantic design-system tokens.
import '@usefragments/ui/styles';
import './styles.css'; // Legacy controls and supporting-page layout.
import './light.scss'; // Supporting-page theme and Fragments configuration.
import './design-system/tokens.scss';
import './design-system/primitives.scss';
import './workspace.scss'; // Workspace shell, tasks, groups, threads, and routines.
import './command-palette.scss';
import './document-workspace.scss';
