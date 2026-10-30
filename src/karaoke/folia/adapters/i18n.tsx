import React from 'react';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

const resources = {
    en: { translation: { ui: { waitingForMusic: 'Waiting for music' } } },
    'zh-CN': { translation: { ui: { waitingForMusic: '等待音乐' } } },
};

export async function createStageI18n(): Promise<I18nInstance> {
    const instance = i18next.createInstance();
    await instance.use(initReactI18next).init({
        lng: 'zh-CN',
        fallbackLng: 'en',
        resources,
        initImmediate: false,
        interpolation: { escapeValue: false },
    });
    return instance;
}

export const StageI18nProvider = I18nextProvider;
