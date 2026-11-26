import { LightningElement, api } from 'lwc';

export default class InvoiceBadge extends LightningElement {
    @api status;

    get label() {
        return this.status === 'Paid' ? 'Paid' : 'Open';
    }
}
