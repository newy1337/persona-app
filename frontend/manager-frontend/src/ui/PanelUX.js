import React from 'react';
import { api } from '../api/client';
import styles from '../styles/AdminPage.module.scss';
import { createPanelUX } from './panel-ux';

export const PanelUX = createPanelUX({ React, api, styles });
