import { useState, type FormEvent } from 'react';
import { createChannel, type ChannelType, type CreatedChannel } from '../api/channels';
import { getApiErrorMessage } from '../api/client';

const MIN_NAME_LENGTH = 3;

interface CreateChannelModalProps {
  onCancel: () => void;
  onCreated: (channel: CreatedChannel) => void;
}

export const CreateChannelModal = ({ onCancel, onCreated }: CreateChannelModalProps) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('PUBLIC');
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateName = (value: string): string | null =>
    value.trim().length >= MIN_NAME_LENGTH
      ? null
      : `Название должно содержать не менее ${MIN_NAME_LENGTH} символов`;

  const handleNameChange = (value: string) => {
    setName(value);
    if (nameError) {
      setNameError(validateName(value));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const error = validateName(name);
    setNameError(error);
    setServerError(null);
    if (error) {
      return;
    }

    setIsSubmitting(true);
    try {
      const channel = await createChannel({ name: name.trim(), type });
      onCreated(channel);
    } catch (requestError) {
      setServerError(getApiErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-channel-title" className="modal__title">
          Создание канала
        </h2>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="channel-name">
              Название канала
            </label>
            <input
              id="channel-name"
              type="text"
              className="input"
              value={name}
              placeholder="Например: Разработка"
              autoFocus
              onChange={(event) => handleNameChange(event.target.value)}
            />
            {nameError && <p className="field__error">{nameError}</p>}
          </div>

          <div className="field">
            <span className="field__label">Тип приватности</span>
            <div className="type-switch">
              <label className="type-switch__option">
                <input
                  type="radio"
                  name="channel-type"
                  value="PUBLIC"
                  checked={type === 'PUBLIC'}
                  onChange={() => setType('PUBLIC')}
                />
                <span className="type-switch__label">
                  Публичный
                  <span className="type-switch__hint">Виден всем, вступить может любой</span>
                </span>
              </label>
              <label className="type-switch__option">
                <input
                  type="radio"
                  name="channel-type"
                  value="PRIVATE"
                  checked={type === 'PRIVATE'}
                  onChange={() => setType('PRIVATE')}
                />
                <span className="type-switch__label">
                  Приватный
                  <span className="type-switch__hint">Только по приглашению</span>
                </span>
              </label>
            </div>
          </div>

          {serverError && <p className="form-error">{serverError}</p>}

          <div className="modal__actions">
            <button type="button" className="button button--secondary" onClick={onCancel}>
              Отмена
            </button>
            <button type="submit" className="button" disabled={isSubmitting}>
              {isSubmitting ? 'Создание...' : 'Создать канал'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
