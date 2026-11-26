import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import getRecentInvoices from '@salesforce/apex/InvoiceController.recentInvoices';
import payInvoice from '@salesforce/apex/InvoiceController.pay';
import INVOICE_OBJECT from '@salesforce/schema/Invoice__c';
import AMOUNT_FIELD from '@salesforce/schema/Invoice__c.Amount__c';
import TIER_FIELD from '@salesforce/schema/Invoice__c.Account__r.Tier__c';
import OVERDUE_NOTICE from '@salesforce/label/c.Overdue_Notice';
import canApprove from '@salesforce/customPermission/Approve_Large_Invoices';

// The recent invoices of an account, and one of them in a form. Status__c is shown by the form, not named here.
export default class InvoiceSummary extends LightningElement {
    @api recordId;
    @api invoiceId;
    objectApiName = INVOICE_OBJECT;
    notice = OVERDUE_NOTICE;

    @wire(getRecentInvoices, { accountId: '$recordId' })
    invoices;

    @wire(getRecord, { recordId: '$invoiceId', fields: [AMOUNT_FIELD, TIER_FIELD] })
    invoice;

    get amount() {
        return getFieldValue(this.invoice.data, AMOUNT_FIELD);
    }

    get tier() {
        return getFieldValue(this.invoice.data, TIER_FIELD);
    }

    get showPay() {
        return canApprove;
    }

    handlePay() {
        payInvoice({ invoiceId: this.invoiceId });
    }
}
