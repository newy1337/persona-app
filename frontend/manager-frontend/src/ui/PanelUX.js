import React from 'react';
import { api } from '../api/client';
import { createPanelUX } from './panel-ux';

export const PanelUX = createPanelUX({ React, api });
