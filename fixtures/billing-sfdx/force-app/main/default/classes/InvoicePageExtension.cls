/**
 * An extension of two pages: of InvoiceList, whose controller is a class, and of InvoiceDetail, whose controller
 * is the standard one of the invoice.
 */
public with sharing class InvoicePageExtension {
    private InvoicePageController listController;
    private ApexPages.StandardController detailController;

    public InvoicePageExtension(InvoicePageController controller) {
        listController = controller;
    }

    public InvoicePageExtension(ApexPages.StandardController controller) {
        detailController = controller;
    }

    public String getSummary() {
        if (listController != null) {
            return listController.invoices.size() + ' invoices, ' + listController.total();
        }
        Invoice__c invoice = (Invoice__c) detailController.getRecord();
        return 'Invoice ' + invoice.Name;
    }
}
